var assert = require('assert');
var PullRequest = require('../../../server/documents/pullRequest').PullRequest;
var pullRequestStore = require('../../../server/services/pullRequestStore');
var sinon = require('sinon');

describe('pullRequestStore', function () {
    var pullRequest = null;

    beforeEach(function () {
        pullRequest = {
            args: {
                "action": "opened",
                "number": 7,
                "pull_request": {
                    "user": {
                        "login": "submitter",
                        "id": 12345678,
                    },
                    "created_at": "2017-09-08T16:27:34Z",
                    "head": {
                        "user": {
                            "login": "committer",
                            "id": 87654321,
                        }
                    },
                    "additions": 41,
                    "deletions": 1,
                    "changed_files": 1
                },
                "repository": {
                    "id": 13579111,
                    "name": "repo",
                    "owner": {
                        "login": "owner",
                        "id": 24681012,
                    }
                }
            }
          };
    });

    describe('storePullRequest', function () {
        beforeEach(function () {
            sinon.stub(PullRequest, 'create', function (pullRequest, done) {
                assert(pullRequest);
                assert(pullRequest.repoId);
                assert(pullRequest.owner);
                assert(pullRequest.repo);
                assert(pullRequest.number);
                assert(pullRequest.user);
                assert(pullRequest.userId);
                assert(pullRequest.created_at);
                done(null, pullRequest);
            });
        });

        afterEach(function () {
            PullRequest.create.restore();
        });

        it('should store pull request info', function (it_done) {
            pullRequestStore.storePullRequest(pullRequest, function (err) {
                assert.ifError(err);
                it_done();
            });
        });
    });

    describe('removePullRequest', function () {
        beforeEach(function () {
            sinon.stub(PullRequest, 'remove', function (query, done) {
                assert(query);
                assert(query.repoId);
                assert(query.number);
                assert(query.userId);
                done();
            });
        });

        afterEach(function () {
            PullRequest.remove.restore();
        });

        it('should remove pull request info', function (it_done) {
            pullRequestStore.removePullRequest(pullRequest, function (err) {
                assert.ifError(err);
                it_done();
            });
        });
    });
});