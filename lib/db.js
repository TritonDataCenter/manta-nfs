// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var events = require('events');
var path = require('path');
var util = require('util');

var assert = require('assert-plus');
var clone = require('clone');
var joi = require('joi');
var levelup = require('levelup');
var nfs = require('nfs');



///--- Globals

var SCHEMA = {
    fhandles: {
        key: '::fhandles:%s',
        schema: {
            path: joi.string().required(),
            ip: joi.string().required(),
            time: joi.date().required()
        }
    },
    mounts: {
        key: '::mounts:%s',
        schema: {
            fhandle: joi.string().length(36).required(),
            ip: joi.string().required(),
            time: joi.date().required()
        }
    }
};



///--- Exports

module.exports = SCHEMA;
