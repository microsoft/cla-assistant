// services
var pullRequest = require('../services/pullRequest');
var status = require('../services/status');
var cla = require('../services/cla');
var repoService = require('../services/repo');
var orgService = require('../services/org');
var log = require('../services/logger');
var config = require('../../config');
var prStore = require('../services/pullRequestStore');

//////////////////////////////////////////////////////////////////////////////////////////////
// Github Pull Request Webhook Handler
//////////////////////////////////////////////////////////////////////////////////////////////

function updateStatusAndComment(args, done) {
    repoService.getPRCommitters(args, function (err, committers) {
        if (!err && committers && committers.length > 0) {
            cla.check(args, function (error, signed, user_map) {
                if (error) {
                    log.warn(new Error(error).stack);
                }
                args.signed = signed;
                status.update(args, function (err) {
                    if (err) {
                        log.error(err, { args: JSON.stringify(args) });
                    }
                    if (config.server.feature_flag.close_comment === 'true' && signed) {
                        return done();
                    }
                    pullRequest.badgeComment(
                        args.owner,
                        args.repo,
                        args.number,
                        signed,
                        user_map,
                        done
                    );
                });
            });
        } else {
            if (!args.handleCount || args.handleCount < 2) {
                args.handleCount = args.handleCount ? ++args.handleCount : 1;
                setTimeout(function () {
                    updateStatusAndComment(args, done);
                }, 10000 * args.handleCount * args.handleDelay);
            } else {
                log.warn(new Error(err).stack, 'PR committers: ', committers, 'called with args: ', args);
            }
        }
    });
};

function handleWebHook(args, done) {
    cla.isClaRequired(args, function (error, isClaRequired) {
        if (error) {
            return done(error);
        }
        if (!isClaRequired) {
            return status.updateForClaNotRequired(args, function (err) {
                if (err) {
                    log.error(err, { args: JSON.stringify(args) });
                }
                pullRequest.deleteComment({
                    repo: args.repo,
                    owner: args.owner,
                    number: args.number
                }, done);
            });
        }
        updateStatusAndComment(args, done);
    });
}

function managePullRequestStore(req, done) {
    if (!isRepoEnabled(req.args.repository)) {
        return done();
    }
    var handleEvents = ['opened', 'reopened', 'closed'];
    if (handleEvents.indexOf(req.args.action) === -1) {
        return done();
    }
    var prInfo = prStore.generatePullRequestInfo(req.args.pull_request);
    cla.getLinkedItem({ repo: prInfo.repo, owner: prInfo.owner }, function (err, item) {
        if (err) {
            return done(err);
        }
        if (!item.gist) {
            return done();
        }
        if (req.args.action === 'opened' || req.args.action === 'reopened') {
            return prStore.storePullRequest(prInfo, done);
        }
        if (req.args.action === 'closed') {
            return prStore.removePullRequest(prInfo, done);
        }
    });
}

module.exports = function (req, res) {
    if (['opened', 'reopened', 'synchronize'].indexOf(req.args.action) > -1 && isRepoEnabled(req.args.repository)) {
        if (req.args.pull_request && req.args.pull_request.html_url) {
            log.info('pull request ' + req.args.action + ' ' + req.args.pull_request.html_url);
        }
        var args = {
            owner: req.args.repository.owner.login,
            repoId: req.args.repository.id,
            repo: req.args.repository.name,
            number: req.args.number
        };
        args.orgId = req.args.organization ? req.args.organization.id : req.args.repository.owner.id;
        args.handleDelay = req.args.handleDelay != undefined ? req.args.handleDelay : 1; // needed for unitTests
        var startTime = process.hrtime();
        setTimeout(function () {
            cla.getLinkedItem(args, function (err, item) {
                if (!item) {
                    return;
                }
                var nullCla = !item.gist;
                var isExcluded = item.orgId && item.isRepoExcluded && item.isRepoExcluded(args.repo);
                if (nullCla || isExcluded) {
                    return;
                }
                args.token = item.token;
                args.gist = item.gist;
                if (item.repoId) {
                    args.orgId = undefined;
                }
                return handleWebHook(args, function (err) {
                    collectMetrics(req.args.pull_request.user.id, startTime, args.signed, req.args.action);
                });
            });
        }, config.server.github.enforceDelay);
    }

    managePullRequestStore(req, function (err) {
        if (err) {
            var pr = prStore.generatePullRequestInfo(req.args.pull_request);
            log.error({ err: err, pullRequest: pr });
        }
    });

    res.status(200).send('OK');
};

function isRepoEnabled(repository) {
    return repository && (repository.private === false || config.server.feature_flag.enable_private_repos === 'true');
}

function collectMetrics(userId, startTime, signed, action) {
    var diffTime = process.hrtime(startTime);
    log.metric('CLAAssistantPullRequestDuration', diffTime[0] * 1000 + Math.round(diffTime[1] / Math.pow(10, 6)));
    if (action !== 'opened') {
        return;
    }
    return cla.isEmployee(userId, function (err, isEmployee) {
        log.metric('CLAAssistantPullRequest', isEmployee ? 0 : 1);
        if (isEmployee) {
            return;
        }
        log.metric(signed ? 'CLAAssistantAlreadySignedPullRequest' : 'CLAAssistantCLARequiredPullRequest', 1);
    });
}