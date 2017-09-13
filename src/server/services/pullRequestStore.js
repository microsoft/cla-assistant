var PullRequest = require('mongoose').model('PullRequest');
var log = require('./logger');

module.exports = {
    storePullRequest: function (prInfo, done) {
        if (!prInfo.repoId || !prInfo.owner || !prInfo.repo || !prInfo.number || !prInfo.user || !prInfo.userId || !prInfo.created_at) {
            return done(new Error('Not enough info to store pull request'));
        }
        PullRequest.create(prInfo, done);
    },

    removePullRequest: function (prInfo, done) {
        if (!prInfo.userId || !prInfo.repoId || !prInfo.number) {
            return done(new Error('Not enough info to delete pull request'));
        }
        var query = {
            userId: prInfo.userId,
            repoId: prInfo.repoId,
            number: prInfo.number
        };
        PullRequest.remove(query, done);
    },

    generatePullRequestInfo: function (pullRequest) {
        return {
            repoId: pullRequest.base.repo.id.toString(),
            owner: pullRequest.base.repo.owner.login,
            repo: pullRequest.base.repo.name,
            number: pullRequest.number.toString(),
            user: pullRequest.user.login,
            userId: pullRequest.user.id.toString(),
            created_at: pullRequest.created_at
        };
    },

    storeIfNotExist: function (prInfo, done) {
        if (!prInfo.repoId || !prInfo.owner || !prInfo.repo || !prInfo.number || !prInfo.user || !prInfo.userId || !prInfo.created_at) {
            return done(new Error('Not enough info to store pull request'));
        }
        var query = {
            userId: prInfo.userId,
            repoId: prInfo.repoId,
            number: prInfo.number
        };
        PullRequest.update(query, { $setOnInsert: prInfo }, { upsert: true }, done);
    }
};