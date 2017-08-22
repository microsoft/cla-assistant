var githubService = require('../services/github');
var log = require('../services/logger');
var q = require('q');

module.exports = {
    couldBeAdmin: function (username) {
        return config.server.github.admin_users.length === 0 || config.server.github.admin_users.indexOf(username) >= 0;
    },

    checkRepoPushPermissionByName: function (repo, owner, token) {
        var deferred = q.defer();
        githubService.call({
            obj: 'repos',
            fun: 'get',
            arg: {
                repo: repo,
                owner: owner
            },
            token: token
        }, function (err, data) {
            if (!err && !data) {
                err = new Error('No data returned');
            }
            if (err && err.code === 404) {
                log.info('You do not have authorization for ' + repo + ' repository.');
            }
            if (err) {
                return deferred.reject(err);
            }
            if (!data.permissions['push']) {
                return deferred.reject('You do not have push permission for this repo');
            }
            deferred.resolve(data);
        });
        return deferred.promise;
    },

    checkRepoPushPermissionById: function (repoId, token, cb) {
        githubService.call({
            obj: 'repos',
            fun: 'getById',
            arg: {
                id: repoId
            },
            token: token
        }, function (err, data) {
            if (err || !data) {
                cb(err, data);
                return;
            }
            var hasPermission = data.permissions['push'];
            cb(err, hasPermission);
        });
    },

    checkOrgAdminPermission: function (org, username, token) {
        var deferred = q.defer();
        githubService.call({
            obj: 'orgs',
            fun: 'getOrgMembership',
            arg: {
                org: org,
                username: username
            },
            token: token
        }, function (err, data) {
            if (!err && !data) {
                err = new Error('No data returned');
            }
            if (err && err.code === 404) {
                log.info('You do not have authorization for ' + org + ' organization.');
            }
            if (err) {
                return deferred.reject(err);
            }
            if (data.role !== 'admin') {
                return deferred.reject('You are not an admin of this org');
            }
            return deferred.resolve(data);
        });
        return deferred.promise;
    },
};