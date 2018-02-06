"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Consts = require('./Consts');
var zlib = require('zlib');
var Db = require('mongodb').Db;
var replaceDot_Atrate = require("./replaceDot");
var Connection = require('mongodb').Connection;
var Server = require('mongodb').Server;
var connectionInstance;
var async = require('async');
var mongoDbConnection = function (conf, callback) {
    if (connectionInstance) {
        callback(null, connectionInstance);
        return;
    }
    var db = new Db(conf.DatabaseName, new Server(conf.mongoIp, conf.mongoPort, { auto_reconnect: true }));
    db.open(function (error, databaseConnection) {
        //if (error) throw new Error(error);
        if (error) {
            callback(error, null);
        }
        else {
            console.log("database connection successfully in connection class");
            connectionInstance = databaseConnection;
            callback(null, databaseConnection);
        }
    });
};
var IStorageClient = /** @class */ (function () {
    // options: any
    function IStorageClient(conf) {
        var _this = this;
        this.conf = conf;
        this.client = require('mongodb').MongoClient;
        mongoDbConnection(conf, function (err, database) {
            if (err) {
                throw err;
            }
            _this.database = database;
            _this.collection = database.collection(conf.collectionName);
        });
    }
    IStorageClient.prototype.retrieve = function (partitionKey, rowKey, callback) {
        var id = partitionKey + ',' + rowKey;
        if (rowKey !== "userData") {
            var query = { "$and": [{ "userid": id }] };
            // console.log("=========retrieve===========", "begin","query",query)
            var iterator = this.database.collection(this.conf.collectionName).find(query);
            iterator.toArray(function (error, result, responseHeaders) {
                if (error) {
                    console.log("=========retrieve===========", "query", query, "Error", error);
                    callback(error, null, null);
                }
                else if (result.length == 0) {
                    console.log("=========retrieve===========", "query", query, 0);
                    callback(null, null, null);
                }
                else {
                    console.log("=========retrieve===========", "query", query, "result", result);
                    var document_1 = result[0];
                    var finaldoc = replaceDot_Atrate.substituteKeyDeep(document_1, /\@/g, '.');
                    finaldoc["id"] = id;
                    callback(null, finaldoc, null);
                }
            });
        }
        else {
            var query = { "$and": [{ "userid": partitionKey }] };
            var iterator = this.database.collection(this.conf.collectionName).find(query);
            iterator.toArray(function (error, result, responseHeaders) {
                if (error) {
                    callback(error, null, null);
                }
                else if (result.length == 0) {
                    callback(null, null, null);
                }
                else {
                    var document_1 = result[0];
                    callback(null, document_1, null);
                }
            });
        }
    };
    IStorageClient.prototype.insertOrReplace = function (partitionKey, rowKey, entity, isCompressed, callback) {
        // console.log("=========insertOrReplace===========", "begin",partitionKey,rowKey,entity,isCompressed)
        var id = partitionKey + ',' + rowKey;
        var docDbEntity = { id: partitionKey + ',' + rowKey, data: entity, isCompressed: isCompressed };
        if (rowKey !== "userData") {
            var newEntitiy = replaceDot_Atrate.substituteKeyDeep(entity, /\./g, '@');
            var conditions1 = {
                'userid': id
            };
            var updateobj1 = {
                "$set": { "data": newEntitiy, "isCompressed": false }
            };
            this.database.collection(this.conf.collectionName).update(conditions1, updateobj1, { upsert: true }, function (err, res) {
                console.log("=========insertOrReplace===========", "err", err, "conditions1", conditions1, "entity", entity);
                callback(err, null, "");
            });
        }
        else {
            var conditions = {
                'userid': partitionKey
            };
            var update = {
                "$set": { "data": entity }
            };
            this.database.collection(this.conf.collectionName).update(conditions, update, { upsert: true }, function (err, res) {
                console.log("=========insertOrReplace===========", "err", err, "conditions", conditions, "entity", entity);
                callback(err, null, "");
            });
        }
    };
    return IStorageClient;
}());
var default_1 = /** @class */ (function () {
    function default_1(conf, options) {
        this.options = options;
        console.log("=========initializeStorageClient===========");
        this.storageClient = new IStorageClient(conf);
    }
    default_1.prototype.getData = function (context, callback) {
        // console.log("=========getData===========", context)
        var storageClient = this.storageClient;
        var list = [];
        if (context.userId) {
            if (context.persistUserData) {
                list.push({
                    partitionKey: context.userId,
                    rowKey: Consts.Fields.UserDataField,
                    field: Consts.Fields.UserDataField
                });
            }
            if (context.conversationId) {
                list.push({
                    partitionKey: context.conversationId,
                    rowKey: context.userId,
                    field: Consts.Fields.PrivateConversationDataField
                });
            }
        }
        if (context.persistConversationData && context.conversationId) {
            list.push({
                partitionKey: context.conversationId,
                rowKey: Consts.Fields.ConversationDataField,
                field: Consts.Fields.ConversationDataField
            });
        }
        var data = {};
        // console.log("list",list)
        async.each(list, function (entry, cb) {
            storageClient.retrieve(entry.partitionKey, entry.rowKey, function (error, entity, response) {
                if (!error) {
                    if (entity) {
                        var botData = entity.data || {};
                        var isCompressed = entity.isCompressed || false;
                        if (isCompressed) {
                            zlib.gunzip(new Buffer(botData, Consts.base64), function (err, result) {
                                if (!err) {
                                    try {
                                        var txt = result.toString();
                                        data[entry.field + Consts.hash] = txt;
                                        data[entry.field] = txt != null ? JSON.parse(txt) : null;
                                    }
                                    catch (e) {
                                        err = e;
                                    }
                                }
                                cb(err);
                            });
                        }
                        else {
                            try {
                                data[entry.field + Consts.hash] = botData ? JSON.stringify(botData) : null;
                                data[entry.field] = botData != null ? botData : null;
                            }
                            catch (e) {
                                error = e;
                            }
                            cb(error);
                        }
                    }
                    else {
                        data[entry.field + Consts.hash] = null;
                        data[entry.field] = null;
                        cb(error);
                    }
                }
                else {
                    cb(error);
                }
            });
        }, function (err) {
            if (!err) {
                callback(null, data);
            }
            else {
                var m = err.toString();
                callback(err instanceof Error ? err : new Error(m), null);
            }
        });
    };
    default_1.prototype.saveData = function (context, data, callback) {
        // console.log("=========saveData===========",context,data)
        var list = [];
        var _this = this;
        function addWrite(field, partitionKey, rowKey, botData) {
            var hashKey = field + Consts.hash;
            var hash = JSON.stringify(botData);
            if (!data[hashKey] || hash !== data[hashKey]) {
                data[hashKey] = hash;
                list.push({ field: field, partitionKey: partitionKey, rowKey: rowKey, botData: botData, hash: hash });
            }
        }
        if (context.userId) {
            if (context.persistUserData) {
                addWrite(Consts.Fields.UserDataField, context.userId, Consts.Fields.UserDataField, data.userData);
            }
            if (context.conversationId) {
                addWrite(Consts.Fields.PrivateConversationDataField, context.conversationId, context.userId, data.privateConversationData);
            }
        }
        if (context.persistConversationData && context.conversationId) {
            addWrite(Consts.Fields.ConversationDataField, context.conversationId, Consts.Fields.ConversationDataField, data.conversationData);
        }
        async.each(list, function (entry, errorCallback) {
            if (_this.options.gzipData) {
                zlib.gzip(entry.hash, function (err, result) {
                    if (!err && result.length > Consts.maxDataLength) {
                        err = new Error("Data of " + result.length + " bytes gzipped exceeds the " + Consts.maxDataLength + " byte limit. Can't post to: " + entry.url);
                        err.code = Consts.ErrorCodes.MessageSize;
                    }
                    if (!err) {
                        _this.storageClient.insertOrReplace(entry.partitionKey, entry.rowKey, result.toString('base64'), true, function (error, eTag, response) {
                            errorCallback(error);
                        });
                    }
                    else {
                        errorCallback(err);
                    }
                });
            }
            else if (entry.hash.length < Consts.maxDataLength) {
                _this.storageClient.insertOrReplace(entry.partitionKey, entry.rowKey, entry.botData, false, function (error, eTag, response) {
                    errorCallback(error);
                });
            }
            else {
                var err = new Error("Data of " + entry.hash.length + " bytes exceeds the " + Consts.maxDataLength + " byte limit. Consider setting connectors gzipData option. Can't post to: " + entry.url);
                err.code = Consts.ErrorCodes.MessageSize;
                errorCallback(err);
            }
        }, function (err) {
            if (callback) {
                if (!err) {
                    callback(null);
                }
                else {
                    var m = err.toString();
                    callback(err instanceof Error ? err : new Error(m));
                }
            }
        });
    };
    return default_1;
}());
exports.default = default_1;