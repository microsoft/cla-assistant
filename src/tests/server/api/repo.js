/*global describe, it, beforeEach, afterEach*/

// unit test
var assert = require('assert');
var sinon = require('sinon');

// module
var repo = require('../../../server/services/repo');
var webhook = require('../../../server/api/webhook');

//model
var Repo = require('../../../server/documents/repo').Repo;


// api
var repo_api = require('../../../server/api/repo');


describe('repo', function () {
    describe('on repo:create', function() {
        var req, res;
        beforeEach(function () {
            req = {
                args: {
                    repoId: 123,
                    repo: 'myRepo',
                    owner: 'login',
                    gist: 1234
                },
                user: {
                    token: 'abc'
                }
            };
            res = {
                repoGet: {
                    err: null,
                    data: null
                },
                repoGetGHRepo: {
                    err: null,
                    data: null
                },
                repoUpdate: {
                    err: null,
                    data: null
                },
                repoCreate: {
                    err: null,
                    data: {
                        repoId: 123,
                        repo: 'myRepo',
                        owner: 'login',
                        gist: 1234
                    }
                }
            };
            sinon.stub(repo, 'get', function (args, done) {
                done(res.repoGet.err, res.repoGet.data);
            });
            sinon.stub(repo, 'getGHRepo', function (args, done) {
                done(res.repoGetGHRepo.err, res.repoGetGHRepo.data);
            });
            sinon.stub(repo, 'create', function (args, done) {
                done(res.repoCreate.err, res.repoCreate.data);
            });
            sinon.stub(repo, 'update', function (args, done) {
                done(res.repoUpdate.err, res.repoUpdate.data);
            });
            sinon.stub(webhook, 'create', function (args, done) {
                done();
            });
        });
        afterEach(function () {
            repo.create.restore();
            repo.get.restore();
            repo.getGHRepo.restore();
            repo.update.restore();
            webhook.create.restore();
        });

        it('should create repo via service', function (it_done) {
            repo_api.create(req, function () {
                assert(repo.get.called);
                assert.equal(repo.create.calledWith({
                    repoId: 123,
                    repo: 'myRepo',
                    owner: 'login',
                    gist: 1234,
                    token: 'abc'
                }), true);
                assert(webhook.create.called);
                it_done();
            });
        });

        it('should update repo if there is one and it is not valid any more', function (it_done) {
            res.repoGet.data = {
                repoId: 321,
                repo: 'myRepo',
                owner: 'login'
            };
            res.repoGetGHRepo.err = 'Repo is not valid anymore';
            repo_api.create(req, function () {
                assert(repo.get.called);
                assert(repo.getGHRepo.called);
                assert.equal(repo.update.calledWith({
                    repoId: 123,
                    repo: 'myRepo',
                    owner: 'login',
                    gist: 1234,
                    token: 'abc'
                }), true);

                it_done();
            });
        });

        it('should update repo if there is one and it is not valid any more', function (it_done) {
            res.repoGet.data = {
                repoId: 321,
                repo: 'myRepo',
                owner: 'login'
            };
            res.repoGetGHRepo.data = {
                id: 123
            };
            repo_api.create(req, function () {
                assert(repo.get.called);
                assert(repo.getGHRepo.called);
                assert.equal(repo.update.calledWith({
                    repoId: 123,
                    repo: 'myRepo',
                    owner: 'login',
                    gist: 1234,
                    token: 'abc'
                }), true);

                it_done();
            });
        });

        it('should fail to create if there is a valid one already', function (it_done) {
            res.repoGet.data = {
                repoId: 123,
                repo: 'myRepo',
                owner: 'login'
            };
            res.repoGetGHRepo.data = {
                id: 123
            };
            repo_api.create(req, function (err) {
                assert(err);
                assert(repo.getGHRepo.called);

                it_done();
            });
        });

        it('should create webhook after create repo entry', function (it_done) {
            repo_api.create(req, function (err) {
                assert.ifError(err);
                assert(!repo.getGHRepo.called);
                assert(repo.create.called);
                assert(webhook.create.called);
                it_done();
            });
        });

        it('should NOT create webhook for null cla repo', function (it_done) {
            res.repoCreate.data.gist = null;
            repo_api.create(req, function (err) {
                assert.ifError(err);
                assert(!repo.getGHRepo.called);
                assert(repo.create.called);
                assert(!webhook.create.called);
                it_done();
            });
        });

        it('should send validation error when owner, repo, repoId, token is absent', function (it_done) {
            req = {
                args: {},
                user: {}
            };
            repo_api.create(req, function (err) {
                assert(err);
                assert(!repo.getGHRepo.called);
                assert(!repo.create.called);
                assert(!webhook.create.called);
                it_done();
            });
        });

        it('should send error when create repo fail', function (it_done) {
            res.repoCreate.err = 'Create repo error';
            repo_api.create(req, function (err) {
                assert(err);
                assert(!repo.getGHRepo.called);
                assert(repo.create.called);
                assert(!webhook.create.called);
                it_done();
            });
        });
    });

    it('should check via repo service', function (it_done) {
        var repoStub = sinon.stub(repo, 'check', function (args, done) {
            assert.deepEqual(args, {
                repo: 'myRepo',
                owner: 'login'
            });
            done();
        });

        var req = {
            args: {
                repo: 'myRepo',
                owner: 'login'
            }
        };

        repo_api.check(req, function () {
            repoStub.restore();
            it_done();
        });
    });

    it('should update via repo service', function (it_done) {
        var repoStub = sinon.stub(Repo, 'findOne', function (args, done) {
            var r = {
                owner: 'login',
                gist: 1234,
                save: function (cb) {
                    assert.equal(this.gist, 'url');
                    cb(null, this);
                }
            };
            done(null, r);
        });

        var req = {
            args: {
                repo: 'myRepo',
                owner: 'login',
                gist: 'url'
            }
        };

        repo_api.update(req, function () {
            repoStub.restore();
            it_done();
        });
    });

    describe('remove', function () {
        var req = null;
        var res = null;
        beforeEach(function () {
            req = {
                args: {
                    repoId: 123,
                },
                user: {
                    token: 'token'
                }
            };
            res = {
                repoRemove: {
                    err: null,
                    data: {
                        repoId: 123,
                        repo: 'myRepo',
                        owner: 'login',
                        gist: 1234
                    }
                }
            };
            sinon.stub(repo, 'remove', function(args, done) {
                done(res.repoRemove.err, res.repoRemove.data);
            });
            sinon.stub(webhook, 'remove', function (args, done) {
                done();
            });
        });

        afterEach(function () {
            repo.remove.restore();
            webhook.remove.restore();
        });

        it('should remove repo entry and webhook when unlink a repo', function (it_done) {
            repo_api.remove(req, function () {
                assert(req.args.owner);
                assert(req.args.repo);
                assert(repo.remove.called);
                assert(webhook.remove.called);
                it_done();
            });
        });

        it('should remove repo entry but not remove webhook when unlink a null CLA repo', function (it_done) {
            res.repoRemove.data.gist = null;
            repo_api.remove(req, function () {
                assert(repo.remove.called);
                assert(!webhook.remove.called);
                it_done();
            });
        });

        it('should send validation error when owner, repo, or repoId is absent', function (it_done) {
            req = {
                args: {},
                user: {}
            };
            repo_api.create(req, function (err) {
                assert(err);
                assert(!repo.remove.called);
                assert(!webhook.remove.called);
                it_done();
            });
        });

        it('should send error when remove repo fail', function (it_done) {
            res.repoRemove.err = 'Remove repo error';
            repo_api.create(req, function (err) {
                assert(err);
                assert(!repo.remove.called);
                assert(!webhook.remove.called);
                it_done();
            });
        });
    });

    it('should get all repos for user', function () {
        sinon.stub(Repo, 'find', function (args, cb) {
            if (args.$or && args.$or[0].repoId === 123) {
                var r = {
                    owner: 'login',
                    gist: 1234,
                    repoId: 123,
                    save: function () {}
                };
                cb(null, [r]);
                return;
            }
            cb('no repo found');
        });

        var req = {
            user: {
                login: 'login'
            },
            args: {
                set: [{
                    owner: 'login',
                    repo: 'repo',
                    repoId: 123
                }]
            }
        };

        repo_api.getAll(req, function (error, res) {
            Repo.find.restore();
            assert.equal(res.length, 1);
        });
    });
});
