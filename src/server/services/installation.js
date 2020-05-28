const App = require('@octokit/app').App;
const request = require('@octokit/request').request;
const logger = require('./logger');
const memCache = require('memory-cache');
const config = require('../../config');

class Installation {

    constructor(cache = memCache, app) {
        this.cache = cache;
        this.app = app || new App({
            id: config.server.github.appId,
            privateKey: config.server.github.appPrivateKey
        });
    }

    async getInstallationAccessToken(repo, owner) {
        try {
            const installationId = repo ? await this.getRepoInstallationId(repo, owner) : await this.getOrgInstallationId(owner);
            return await this.app.getInstallationAccessToken({ installationId });
        } catch (err) {
            logger.trackEvent('github.getInstallationAccessToken.Failed', { repo, owner });
            return;
        }
    }

    async getRepoInstallationId(repo, owner) {
        const key = `${owner}/${repo}`;
        const existing = this.cache.get(key);
        if (existing) {
            return existing;
        }
        const jwt = this.app.getSignedJsonWebToken();
        const { data } = await request('GET /repos/:owner/:repo/installation', {
            owner,
            repo,
            headers: {
                authorization: `Bearer ${jwt}`,
                accept: 'application/vnd.github.machine-man-preview+json',
            }
        });
        cache.push(key, data.id);
        return data.id
    }

    async getOrgInstallationId(org) {
        const existing = this.cache.get(org);
        if (existing) {
            return existing;
        }
        const jwt = this.app.getSignedJsonWebToken();
        const { data } = await request('GET /orgs/:org/installation', {
            org,
            headers: {
                authorization: `Bearer ${jwt}`,
                accept: 'application/vnd.github.machine-man-preview+json',
            }
        });
        cache.push(org, data.id);
        return data.id
    }
}

module.exports = new Installation();