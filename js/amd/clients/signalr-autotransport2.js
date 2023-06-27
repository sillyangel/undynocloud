define([
    "underscore"
],function(
    _
){
    var events = {
        onStart: "onStart",
        onStarting: "onStarting",
        onReceived: "onReceived",
        onError: "onError",
        onConnectionSlow: "onConnectionSlow",
        onReconnecting: "onReconnecting",
        onReconnect: "onReconnect",
        onStateChanged: "onStateChanged",
        onDisconnect: "onDisconnect"
    };
    var resources = {
        nojQuery: "jQuery was not found. Please ensure jQuery is referenced before the SignalR client JavaScript file.",
        noTransportOnInit: "No transport could be initialized successfully. Try specifying a different transport or none at all for auto initialization.",
        errorOnNegotiate: "Error during negotiation request.",
        stoppedWhileLoading: "The connection was stopped during page load.",
        stoppedWhileNegotiating: "The connection was stopped during the negotiate request.",
        errorParsingNegotiateResponse: "Error parsing negotiate response.",
        protocolIncompatible: "You are using a version of the client that isn't compatible with the server. Client version {0}, server version {1}.",
        sendFailed: "Send failed.",
        parseFailed: "Failed at parsing response: {0}",
        longPollFailed: "Long polling request failed.",
        eventSourceFailedToConnect: "EventSource failed to connect.",
        eventSourceError: "Error raised by EventSource",
        webSocketClosed: "WebSocket closed.",
        pingServerFailedInvalidResponse: "Invalid ping response when pinging server: '{0}'.",
        pingServerFailed: "Failed to ping server.",
        pingServerFailedStatusCode: "Failed to ping server.  Server responded with status code {0}, stopping the connection.",
        pingServerFailedParse: "Failed to parse ping server response, stopping the connection.",
        noConnectionTransport: "Connection is in an invalid state, there is no transport active.",
        webSocketsInvalidState: "The Web Socket transport is in an invalid state, transitioning into reconnecting."
    };
    var signalR = $.signalR;
    var _negotiateAbortText = "__Negotiate Aborted__";
    
    
    return {
        create: function () {
            var autoTransport = {
                connection: null,
                transports: [
                    $.signalR.transports.webSockets,
                    $.signalR.transports.serverSentEvents,
                    $.signalR.transports.longPolling
                ],
                transportIndex: 0,
                start: function (){
                    if (!autoTransport.connection){
                        throw new Error("cannot start without connection");
                    }
                    if (!autoTransport.connection.host){
                        autoTransport.initConnectionUrl();
                    }
                    autoTransport.connection.groupsToken = null;//always initialize to an empty token so we can track if the server updated us
                    var transport = autoTransport.transports[autoTransport.transportIndex];
                    autoTransport.connection.transport = transport;
                    $.signalR.changeState(autoTransport.connection, 
                        $.signalR.connectionState.disconnected,
                        $.signalR.connectionState.connecting                    
                    );
                    var initializationComplete = false;
                    window.clearTimeout(autoTransport.connection._.onFailedTimeoutHandle);
                    return new Promise(function(resolve, reject) {
                        autoTransport.negotiate().then(function (res) {
                            var onFailed = function () {
                                // Check if we've already triggered onFailed, onStart
                                if (!initializationComplete) {
                                    initializationComplete = true;
                                    window.clearTimeout(autoTransport.connection._.onFailedTimeoutHandle);
                                    transport.stop(autoTransport.connection);
                                    reject("timeout");
                                }
                            };
                            //fallback immediately if we dont support websockets
                            //but we can reuse the negotiate since we havent wasted it
                            if (!res.TryWebSockets && transport.name === "webSockets"){
                                autoTransport.transportIndex++;
                                transport = autoTransport.transports[autoTransport.transportIndex];
                                autoTransport.connection.transport = transport;
                            }
                            autoTransport.connection._.onFailedTimeoutHandle = _.delay(function () {
                                autoTransport.connection.log(transport.name + " timed out when trying to connect.");
                                onFailed();
                            }, autoTransport.connection.transportConnectTimeout);

                            transport.start(autoTransport.connection, resolve, reject);
                        }, function (err){
                            if (err.message === resources.stoppedWhileNegotiating){ 
                                reject(err);
                            } else {
                                reject($.signalR._.error(resources.errorOnNegotiate, err /* error */, autoTransport.connection._.negotiateRequest));                                
                            }
                        });
                    }).then(function (){
                        initializationComplete = true;
                        clearTimeout(autoTransport.connection._.onFailedTimeoutHandle);
                        if (transport.supportsKeepAlive && autoTransport.connection._.keepAliveData.activated) {
                            signalR.transports._logic.monitorKeepAlive(autoTransport.connection);
                        }

                        signalR.transports._logic.startHeartbeat(autoTransport.connection);

                        $.signalR.changeState(autoTransport.connection,
                            signalR.connectionState.connecting,
                            signalR.connectionState.connected);

                        // Drain any incoming buffered messages (messages that came in prior to connect)
                        autoTransport.connection._.connectingMessageBuffer.drain();

                        $(autoTransport.connection).triggerHandler(events.onStart);
                    }, function(err){
                        if (err && err.message === resources.errorOnNegotiate) { throw err; }
                        autoTransport.transportIndex++;
                        if (autoTransport.transportIndex >= autoTransport.transports.length){ throw err;}
                        if (transport) {
                            transport.stop(autoTransport.connection);
                        }
                        $.signalR.changeState(autoTransport.connection, 
                            $.signalR.connectionState.connecting,
                            $.signalR.connectionState.disconnected
                        );
                        return autoTransport.start();
                    });
                },
                negotiate: function () {
                    var url = autoTransport.connection.url + "/negotiate";
                    var signalR = $.signalR;
                    //note there was some unexpected behavior around the rethrow in our 
                    //catch below where it was skipping the immediate deferred's failback and instead
                    //bounded to the containing failback on the promise externally
                    var deferred = $.Deferred();

                    $(autoTransport.connection).triggerHandler(events.onStarting);

                    url = signalR.transports._logic.prepareQueryString(autoTransport.connection, url);

                    // Add the client version to the negotiate request.  We utilize the same addQs method here
                    // so that it can append the clientVersion appropriately to the URL
                    url = signalR.transports._logic.addQs(url, {
                        clientProtocol: autoTransport.connection.clientProtocol
                    });

                    autoTransport.connection.log("Negotiating with '" + url + "'.");
                    var onFailed = function (error) {
                        var err = $.signalR._.error(resources.errorOnNegotiate, error, autoTransport.connection._.negotiateRequest);
                        $(autoTransport.connection).triggerHandler(events.onError, err);
                       deferred.reject(err);
                        // Stop the connection if negotiate failed
                        autoTransport.connection.stop();
                    };
                    // Save the ajax negotiate request object so we can abort it if stop is called while the request is in flight.
                    autoTransport.connection._.negotiateRequest = $.ajax(
                        $.extend({}, $.signalR.ajaxDefaults, {
                            xhrFields: { withCredentials: autoTransport.connection.withCredentials },
                            url: url,
                            type: "GET",
                            contentType: autoTransport.connection.contentType,
                            data: {},
                            dataType: autoTransport.connection.ajaxDataType
                        })
                    );
                    autoTransport.connection._.negotiateRequest.then(function (result) {
                        var res,
                            keepAliveData,
                            protocolError,
                            transports = [],
                            supportedTransports = [];

                        try {
                            res = autoTransport.connection._parseResponse(result);
                        } catch (error) {
                            onFailed(signalR._.error(resources.errorParsingNegotiateResponse, error), autoTransport.connection);
                            return;
                        }

                        keepAliveData = autoTransport.connection._.keepAliveData;
                        autoTransport.connection.appRelativeUrl = res.Url;
                        autoTransport.connection.id = res.ConnectionId;
                        autoTransport.connection.token = res.ConnectionToken;
                        autoTransport.connection.webSocketServerUrl = res.WebSocketServerUrl;

                        // Once the server has labeled the PersistentConnection as Disconnected, we should stop attempting to reconnect
                        // after res.DisconnectTimeout seconds.
                        autoTransport.connection.disconnectTimeout = res.DisconnectTimeout * 1000; // in ms

                        // If the connection already has a transportConnectTimeout set then keep it, otherwise use the servers value.
                        autoTransport.connection.transportConnectTimeout = autoTransport.connection.transportConnectTimeout + res.TransportConnectTimeout * 1000;

                        // If we have a keep alive
                        if (res.KeepAliveTimeout) {
                            // Register the keep alive data as activated
                            keepAliveData.activated = true;

                            // Timeout to designate when to force the connection into reconnecting converted to milliseconds
                            keepAliveData.timeout = res.KeepAliveTimeout * 1000;

                            // Timeout to designate when to warn the developer that the connection may be dead or is not responding.
                            keepAliveData.timeoutWarning = keepAliveData.timeout * autoTransport.connection.keepAliveWarnAt;

                            // Instantiate the frequency in which we check the keep alive.  It must be short in order to not miss/pick up any changes
                            autoTransport.connection._.beatInterval = (keepAliveData.timeout - keepAliveData.timeoutWarning) / 3;
                        } else {
                            keepAliveData.activated = false;
                        }

                        autoTransport.connection.reconnectWindow = autoTransport.connection.disconnectTimeout + (keepAliveData.timeout || 0);

                        if (!res.ProtocolVersion || res.ProtocolVersion !== autoTransport.connection.clientProtocol) {
                            protocolError = signalR._.error(signalR._.format(resources.protocolIncompatible, autoTransport.connection.clientProtocol, res.ProtocolVersion));
                            $(autoTransport.connection).triggerHandler(events.onError, [protocolError]);
                            throw protocolError;
                        }
                        deferred.resolve(res);

                    }, function (error, statusText) {
                            // We don't want to cause any errors if we're aborting our own negotiate request.
                            if (statusText !== _negotiateAbortText) {
                                onFailed(error, autoTransport.connection);
                                deferred.reject(error);
                            } else {
                                // This rejection will noop if the deferred has already been resolved or rejected.
                                deferred.reject(signalR._.error(resources.stoppedWhileNegotiating, null /* error */, autoTransport.connection._.negotiateRequest));
                            }
                    });
                    return deferred;
                },
                initConnectionUrl: function () {
                    var parser = window.document.createElement("a");
                    // Resolve the full url
                    parser.href = autoTransport.connection.url;
                    if (!parser.protocol || parser.protocol === ":") {
                        autoTransport.connection.protocol = window.document.location.protocol;
                        autoTransport.connection.host = window.document.location.host;
                        autoTransport.connection.baseUrl = autoTransport.connection.protocol + "//" + autoTransport.connection.host;
                    } else {
                        autoTransport.connection.protocol = parser.protocol;
                        autoTransport.connection.host = parser.host;
                        autoTransport.connection.baseUrl = parser.protocol + "//" + parser.host;
                    }

                    // Set the websocket protocol
                    autoTransport.connection.wsProtocol = autoTransport.connection.protocol === "https:" ? "wss://" : "ws://";

                    autoTransport.connection.ajaxDataType = "text";
                }
            };

            return autoTransport;
        }
    };
});