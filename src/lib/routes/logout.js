'use strict';

const Controller = require('./controller');

class LogoutController extends Controller {
    constructor(config) {
        super(config);
        this.get('/', this.logout);
    }

    logout(req, res) {
        if (req.session) {
            req.session.destroy();
        }
        if (req.logout) {
            req.logout();
        }
        res.set('Clear-Site-Data', '"cookies"');
        res.redirect(`${this.config.baseUriPath}/`);
    }
}

module.exports = LogoutController;
