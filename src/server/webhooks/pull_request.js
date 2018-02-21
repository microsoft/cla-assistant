require('../documents/user');

// services
let pullRequest = require('../services/pullRequest');
let status = require('../services/status');
let cla = require('../services/cla');
let repoService = require('../services/repo');
let orgService = require('../services/org');
let log = require('../services/logger');
let config = require('../../config');
let User = require('mongoose').model('User');


//////////////////////////////////////////////////////////////////////////////////////////////
// Github Pull Request Webhook Handler
//////////////////////////////////////////////////////////////////////////////////////////////

function storeRequest(committers, repo, owner, number) {
    committers.forEach(function (committer) {
        User.findOne({ name: committer }, (err, user) => {
            let pullRequest = { repo: repo, owner: owner, numbers: [number] };
            if (!user) {
                User.create({ name: committer, requests: [pullRequest] }, (err, user) => {
                    if (err) {
                        log.warn(new Error(err).stack);
                    }
                });
                return;
            }
            if (!user.requests || user.requests.length < 1) {
                user.requests = user.requests ? user.requests : [];
                user.requests.push(pullRequest);
                user.save();
                return;
            }
            let repoPullRequests = user.requests.find((request) => {
                return request.repo === repo && request.owner === owner;
            });
            if (repoPullRequests && repoPullRequests.numbers.indexOf(number) < 0) {
                repoPullRequests.numbers.push(number);
                user.save();
            }
            if (!repoPullRequests) {
                user.requests.push(pullRequest);
                user.save();
            }
        });
    });
}

function updateStatusAndComment(args, done) {
    repoService.getPRCommitters(args, function (err, committers) {
        if (!err && committers && committers.length > 0) {
            cla.check(args, function (error, signed, user_map) {
                if (error) {
                    log.warn(new Error(error).stack);
                }
                args.signed = signed;
                if (user_map && user_map.not_signed) {
                    storeRequest(user_map.not_signed, args.repo, args.owner, args.number);
                }
                status.update(args, function (err) {
                    if (err) {
                        log.error(err, { args: JSON.stringify(args) });
                    }
                    if (config.server.feature_flag.close_comment && signed) {
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
        args.isClaRequired = isClaRequired;
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

module.exports = function (req, res) {
    if (['opened', 'reopened', 'synchronize'].indexOf(req.args.action) > -1 && isRepoEnabled(req.args.repository)) {
        if (req.args.pull_request && req.args.pull_request.html_url) {
            log.info('pull request ' + req.args.action + ' ' + req.args.pull_request.html_url);
        }
        let args = {
            owner: req.args.repository.owner.login,
            repoId: req.args.repository.id,
            repo: req.args.repository.name,
            number: req.args.number
        };
        args.orgId = req.args.organization ? req.args.organization.id : req.args.repository.owner.id;
        args.handleDelay = req.args.handleDelay != undefined ? req.args.handleDelay : 1; // needed for unitTests
        let startTime = process.hrtime();
        setTimeout(function () {
            cla.getLinkedItem(args, function (err, item) {
                if (!item) {
                    return;
                }
                let nullCla = !item.gist;
                let isExcluded = item.orgId && item.isRepoExcluded && item.isRepoExcluded(args.repo);
                if (nullCla || isExcluded) {
                    return;
                }
                args.token = item.token;
                args.gist = item.gist;
                if (item.repoId) {
                    args.orgId = undefined;
                }
                return handleWebHook(args, function (err) {
                    collectMetrics(req.args.pull_request, startTime, args.signed, req.args.action, args.isClaRequired);
                });
            });
        }, config.server.github.enforceDelay);
    }

    res.status(200).send('OK');
};

function isRepoEnabled(repository) {
    return repository && (repository.private === false || config.server.feature_flag.enable_private_repos);
}

function collectMetrics(pullRequest, startTime, signed, action, isClaRequired) {
    let diffTime = process.hrtime(startTime);
    const logProperty = {
        owner: pullRequest.base.repo.owner.login,
        repo: pullRequest.base.repo.name,
        number: pullRequest.number.toString(),
        signed: signed && signed.toString(),
        isClaRequired: isClaRequired.toString(),
        action: action
    };
    log.trackEvent('CLAAssistantPullRequestDuration', logProperty, { CLAAssistantPullRequestDuration: diffTime[0] * 1000 + Math.round(diffTime[1] / Math.pow(10, 6)) });
    if (action !== 'opened') {
        return;
    }
    return cla.isEmployee(pullRequest.user.id, function (err, isEmployee) {
        log.trackEvent('CLAAssistantPullRequest', Object.assign(logProperty, { isEmployee: isEmployee.toString() }), { CLAAssistantPullRequest: isEmployee ? 0 : 1 });
        if (isEmployee || !isClaRequired) {
            return;
        }
        log.trackEvent(signed ? 'CLAAssistantAlreadySignedPullRequest' : 'CLAAssistantCLARequiredPullRequest', logProperty, signed ? { CLAAssistantAlreadySignedPullRequest: 1 } : { CLAAssistantCLARequiredPullRequest: 1 });
    });
}
