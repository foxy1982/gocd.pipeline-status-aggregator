var Promise = require('bluebird');
var _ = require('lodash');
var moment = require('moment');
var logger = require('./logger');
var eventEmitter = require('./events');
var amqp = require('./amqp');
var credentialsLoader = require('./config');
var GoClient = require('./gocd');
var TeamConfiguration = require('./teamConfiguration')

logger.logInfo('Starting GOCD Pipline Status Aggregator');

function buildPipelineDocumentKey(pipelineEvent) {
	return pipelineEvent.pipeline.group + '_' + pipelineEvent.pipeline.name + '_' + pipelineEvent.pipeline.counter;
}

function storePipelineStatus(teams, pipelineResult, apiResponse) {
	return new Promise(function (resolve, reject) {
		var pipelineEvent = pipelineResult.result;

		var doucmentKey = buildPipelineDocumentKey(pipelineEvent);

		var team = teams.findTeamFromGroupOrPipeline(pipelineEvent.pipeline.group) || pipelineEvent.pipeline.group;

		var currentStageIndex = _.findIndex(apiResponse.stages, function(stage) {
			return stage.name === pipelineEvent.pipeline.stage.name;
		}) + 1;

		var releaseStatus = {
			pipeline: pipelineEvent.pipeline.name,
			counter: pipelineEvent.pipeline.counter,
			group:  pipelineEvent.pipeline.group,
			team: team
		};

		if(apiResponse && apiResponse.stages.length) {
			_.merge(releaseStatus, {
				totalStages: apiResponse.stages.length,
				currentStage: {
					number: currentStageIndex,
					name: pipelineEvent.pipeline.stage.name,
					state: pipelineEvent.pipeline.stage.state,
					result: pipelineEvent.pipeline.stage.result
				}
			});

			if(apiResponse.stages[0].jobs.length) {
				_.merge(releaseStatus, {
					startedAt: moment(apiResponse.stages[0].jobs.scheduled_date).format()
				});
			}
		}

		logger.logInfo('Setting release status document[' + doucmentKey + ']' + JSON.stringify(releaseStatus, null, 4));

		resolve();
	});
}

function storeStageStatus(teams, pipelineEvent, apiResponse) {
	return new Promise(function (resolve, reject) {
		resolve();
	});
}

function handleMessage(goClient, teams, pipelineEvent) {
	var pipelineStatusUpdate = pipelineEvent.result;

	if(pipelineEvent.type !== 'pipelineResult') {
		return;
	}

	function storePipelineAndStageStatus(pipelineApiResponse) {
		return Promise.all([
			storePipelineStatus(teams, pipelineEvent, pipelineApiResponse),
			storeStageStatus(teams, pipelineEvent, pipelineApiResponse)
		]);
	}

	goClient
		.getPipelineInstance(pipelineStatusUpdate.pipeline.name, pipelineStatusUpdate.pipeline.counter)
		.then(storePipelineAndStageStatus)
		.catch(function(err) {
			logger.logError(err);
		});
}

new credentialsLoader().load()
	.then(function(config) {
		return new Promise(function(resolve, reject) {
			logger.logInfo('Startup Complete');

			var goClient = new GoClient({
				host: 'go.laterooms.com',
				port: 8153
			}, config.credentials);
			var teams = new TeamConfiguration(config.teams);

			resolve(handleMessage.bind(undefined, goClient, teams));
		});
	})
	.then(function(handleMessage) {
		return amqp(handleMessage, logger, { 
			"host": "127.0.0.1", 
			"exchange": "river-styx", 
			"routing": "pipelineResult", 
			"queue": "pipelineResult-aggregator" 
		}).start();
	});
