var http = require('http');
var moment = require('moment');
var Promise = require('bluebird');
var _ = require('lodash');
var elasticsearch = require('elasticsearch');

var client = new elasticsearch.Client({
  host: 'logs.elasticsearch.laterooms.io:9200'
});

var logger = require('../../logger').forModule('Material Link');

module.exports = function storeMaterialLink(teams, pipelineEvent, apiResponse) {
    var buildCauses = pipelineEvent.result.pipeline['build-cause'];

    var baseInformation = {
        '@timestamp': pipelineEvent.result.pipeline.stage['create-time'],
        fullPath: pipelineEvent.result.pipeline.name + '/' + pipelineEvent.result.pipeline.counter + '/' + pipelineEvent.result.pipeline.stage.name + '/' + pipelineEvent.result.pipeline.stage.counter,
        pipeline: {
            group: pipelineEvent.result.pipeline.group,
            name: pipelineEvent.result.pipeline.name,
            counter: pipelineEvent.result.pipeline.counter
        },
        stage: {
            name: pipelineEvent.result.pipeline.stage.name,
            counter: pipelineEvent.result.pipeline.stage.counter
        }
    };

    function material(baseInformation, cause) {
        return _.merge({
            type: cause.material.type,
            changed: cause.changed,
            revision: cause.modifications[0].revision
        }, JSON.parse(JSON.stringify(baseInformation)));
    }

    function materialId(baseInformation, cause) {
        var id = baseInformation.fullPath + '_';

        if(cause.material.type === 'git') {
            id += cause.material['git-configuration'].url + '_';
        }

        id += cause.modifications[0].revision;

        var sanitizedId = id.replace(/[^0-9a-z]/ig, "");

        return { id: sanitizedId };
    }

    function materialConfig(baseInformation, cause) {
        var config = cause.material[cause.material.type + '-configuration'];

        return config;
    }

    function materialLag(baseInformation, cause) {
        if(pipelineEvent.result.pipeline.stage['approved-by'] === 'changes' && pipelineEvent.result.pipeline.stage.counter == 1 && cause.changed) {
            return {
                commitToTriggerInMs: moment(baseInformation['@timestamp']).diff(moment(cause.modifications[0]['modified-time']), 'ms')
            };
        }
    }

    var materialLinks = buildCauses.map(function(cause) {
        return _.merge(material(baseInformation, cause), materialId(baseInformation, cause), materialConfig(baseInformation, cause), materialLag(baseInformation, cause));
    });
    var index = 'releases-' + moment().format('YYYY.MM');
    var type = 'pipeline-material';

    var bulkUpdate = [];
    materialLinks.forEach(function(materialLink) {
        bulkUpdate.push({ update: { _index: index, _type: type, _id: materialLink.id } });
        bulkUpdate.push({ doc: materialLink, doc_as_upsert: true });
    });

    return client.bulk({ body: bulkUpdate })
        .then(function() {
            logger.logInfo('Elasticsearch MaterialLink documents written successfully.', {
                materialLinks: _.pluck(materialLinks, 'id').join(', ')
            });
        })
        .catch(function(err) {
            logger.logInfo('Error writing to elasticsearch, MaterialLink documents written successfully.', {
                materialLinks: _.pluck(materialLinks, 'id').join(', ')
            });
            console.log(err);
        });
};
