var http = require('http');
var moment = require('moment');
var Promise = require('bluebird');
var _ = require('lodash');

var logger = require('../../logger').forModule('Material Link');
var eventEmitter = require('../../events');

module.exports = function storeMaterialLink(teams, pipelineEvent, apiResponse) {
    return new Promise(function (resolve, reject) {
        resolve();
    });
};
