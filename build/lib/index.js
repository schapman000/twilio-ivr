"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const State = require("./state");
const routeCreationHelpers_1 = require("./util/routeCreationHelpers");
const staticFiles_1 = require("./modules/staticFiles");
const express = require("express");
const bodyParser = require("body-parser");
const twilio_1 = require("twilio");
require("./twilioAugments");
function default_1(states, config) {
    const app = express();
    app.use(bodyParser.urlencoded({ extended: false }));
    const { validate = true } = config.twilio;
    app.use(twilio_1.webhook(config.twilio.authToken, { validate: validate }));
    let urlFingerprinter;
    if (config.staticFiles) {
        let serveStaticMiddlewares;
        [serveStaticMiddlewares, urlFingerprinter] = staticFiles_1.default(config.staticFiles);
        app.use(config.staticFiles.mountPath || "", serveStaticMiddlewares);
    }
    states.forEach(thisState => {
        if (!State.isValidState(thisState)) {
            const stateAsString = State.stateToString(thisState);
            throw new Error("Invalid state provided: " + stateAsString);
        }
        if (State.isRoutableState(thisState)) {
            app.post(thisState.uri, function (req, res, next) {
                routeCreationHelpers_1.renderState(thisState, req, urlFingerprinter, req.body)
                    .then(twiml => { res.send(twiml); })
                    .catch(next);
            });
        }
        if (State.isNormalState(thisState)) {
            app.post(thisState.processTransitionUri, function (req, res, next) {
                const nextStatePromise = Promise.resolve(thisState.transitionOut(req.body));
                nextStatePromise
                    .then(nextState => {
                    return routeCreationHelpers_1.renderState(nextState, req, urlFingerprinter, undefined);
                })
                    .then(twiml => { res.send(twiml); })
                    .catch(next);
            });
        }
    });
    return app;
}
exports.default = default_1;
