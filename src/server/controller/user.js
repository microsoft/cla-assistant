let passport = require('passport');
let express = require('express');
let utils = require('../middleware/utils');
const logger = require('../services/logger');

//////////////////////////////////////////////////////////////////////////////////////////////
// User controller
//////////////////////////////////////////////////////////////////////////////////////////////

let router = express.Router();
let scope;

function checkReturnTo(req, res, next) {
    scope = null;
    req.session.requiredScope = null;
    if (!req.session) {
        req.session = {};
    }

    if (req.query.public === 'true') {
        scope = config.server.github.user_scope.concat();
        req.session.requiredScope = 'public';
    }
    if (req.query.admin === 'true') {
        scope = config.server.github.admin_scope.concat();
        req.session.requiredScope = 'admin';
    }
    if (req.query.org_admin === 'true') {
        scope.push('admin:org_hook');
        req.session.requiredScope = 'org_admin';
    }

    req.session.returnTo = req.query.public === 'true' ? req.session.next || req.headers.referer : '/';

    passport.authenticate('github', {
        scope: scope
    })(req, res, next);
}

router.get('/auth/github', checkReturnTo);

router.get('/auth/github/callback', (req, res, next) => {
    passport.authenticate('github', (err, user) => {
        if (err) {
            logger.error(err);
            return res.redirect('/');
        }
        if (!user) {
            return res.redirect('/');
        }
        req.login(user, loginErr => {
            if (loginErr) {
                logger.error(loginErr);
                return res.redirect('/');
            }
            if (req.user && req.session.requiredScope != 'public' && utils.couldBeAdmin(req.user.login) && (!req.user.scope || req.user.scope.indexOf('write:repo_hook') < 0)) {
                return res.redirect('/auth/github?admin=true');
            }
            res.redirect(req.session.returnTo || req.headers.referer || '/');
            req.session.next = null;
        });
    })(req, res, next);
});

router.get('/logout',
    function (req, res, next) {
        req.logout();
        if (!req.query.noredirect) {
            res.redirect('/');
        } else {
            next();
        }
    }
);

module.exports = router;