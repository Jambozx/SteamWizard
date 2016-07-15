"using strict";
/*http://stackoverflow.com/a/18405800*/
if (!String.prototype.format) {
	String.prototype.format = function() {
		var args = arguments;
		return this.replace(/{(\d+)}/g, function(match, number) {
			return typeof args[number] != 'undefined'
				? args[number]
				: match
			;
		});
	};
}

var steamwizard = (function() {
    /* list of functions to be called after we finish initializing */
    var onReadyList = [];
    
    /* list of functions to be called if the plugin was switched on or off */
    var onChangeList = [];
    
    /* is the plugin enabled or disabled */
    var isEnabled = false;
    
    /* did we finish initialization or not */
    var isReady = false;
    
    /* do we have a valid token or not */
    var isLoggedIn = false;
    
    /* api token */
    var token = null;
    
    /* our local storage */
    var storage = {};
	    
    /* name must not include "_" */
    var NAMESPACE_SCREENSHOT     = "screenshot";
    var NAMESPACE_MARKET_INSPECT = "marketinspect";

    function validateToken(token) {
        if(token == null)
           return false;

        try {
            var json = JSON.parse(atob(token));
        } catch(e) {
            return false;
        }

        if(json.timestamp == null || new Date().getTime() - json.timestamp > 2 * 24 * 60 * 60 * 1000)
           return false;

        return true;
    }

    function loginCallback(response) {
        if(response.success === true) {
           token = response.token;
           window.localStorage.setItem('steam_wizard_token', response.token);
        }
    }

    function processLogin() {
        /* make sure both services are enabled */
        if(token !== null) {
           csgozone.setToken(token);
           metjm.setToken(token);
        }
            
        isLoggedIn = token !== null;
    }
    
    function onMessage(request, port) {
        switch(request.msg) {
            case 'pluginStatus':
                 isEnabled = request.status;
                 for(var i = 0; i < onChangeList.length; i++)
                     onChangeList[i](isEnabled);                     
                 break;
            
            /* TODO 
             * case 'newItem':
             * 
             * 
             * */
        }
    }
    
    function ready() {
        processLogin();
        
        isReady = true;
        
        for(var i=0; i < onReadyList.length; i++)
            onReadyList[i]();
    }

    /* start init */
    function init() {
        token = window.localStorage.getItem('steam_wizard_token');

        if(!validateToken(token)) {
            token = null;
            window.localStorage.removeItem('steam_wizard_token');
        }
        
        /* ask backend for initialization stuff */
		var port = chrome.runtime.connect();        
        var localListener = function(request, port) {
            switch(request.msg) {
                case 'pluginStatus':
                     isEnabled = request.status;                   
                     break;
                case 'storageResponse':
                     storage[request.namespace] = request.value || {};
                     break;
            }
            
            /* each id maps to a deferred */
            deferredList[request.requestid].resolve();
        };
        
        var deferredList = [$.Deferred(), $.Deferred(), $.Deferred()];
        
        port.onMessage.addListener(localListener);
        port.postMessage({msg: 'getPluginStatus', requestid: 0});
        port.postMessage({msg: 'getStorage', namespace: NAMESPACE_SCREENSHOT, requestid: 1});
        port.postMessage({msg: 'getStorage', namespace: NAMESPACE_MARKET_INSPECT, requestid: 2});

        if(token === null) {
           deferredList.push(csgozone.login(loginCallback));
           deferredList.push(metjm.login(loginCallback));
        }
        
        $.when.apply(null, deferredList).then(function() {
            port.onMessage.removeListener(localListener);
            port.onMessage.addListener(onMessage);
            console.log(storage);
            ready();
        });
		
		setTimeout(function(){
			steamwizard.port = port;
		},0);
    }

    init();
        
    return {
        EVENT_STATUS_PROGRESS: 1,
        EVENT_STATUS_DONE: 2,
        EVENT_STATUS_FAIL: 3,
        
        /* JQUERY STYLE */
        ready: function(callback) {
            if(isReady)
               callback();
            else 
               onReadyList.push(callback);
        },
        
        onChange: function(callback) {
            if(onChangeList.indexOf(callback) > -1)
               return;
            
            onChangeList.push(callback);
        },
        
        isEnabled: function() {
            return isEnabled;
        },
        
        isLoggedIn: function() {
            return isLoggedIn;
        },
        
        revokeToken: function() {
            token = null;
            window.localStorage.removeItem('steam_wizard_token');
            isLoggedIn = false;
        },
        
        login: function(callback) {
            $.when(csgozone.login(loginCallback), metjm.login(loginCallback)).then(function() {
                processLogin();
                callback();
            });
        },
            
        getScreenshot: function(inspectLink, callback) {
			var shortLink = steamwizard.getShortInspectLink(inspectLink);
			var cache = steamwizard.getScreenshotCache();
			if (shortLink != null && cache[shortLink]){
				callback({status: steamwizard.EVENT_STATUS_DONE , image_url: cache[shortLink]});
			}else{
				metjm.requestScreenshot(inspectLink, function(result){
						if (result.success) {
								if(result.result.status == metjm.STATUS_QUEUE){
										callback({status: steamwizard.EVENT_STATUS_PROGRESS , msg: 'Queue: ' + result.result.place_in_queue});
								}else if (result.result.status == metjm.STATUS_DONE){
										steamwizard.port.postMessage({msg: 'storeItem', namespace: NAMESPACE_SCREENSHOT, key: shortLink, value: result.result.image_url});
										callback({status: steamwizard.EVENT_STATUS_DONE , image_url: result.result.image_url});
								}else{
										callback({status: steamwizard.EVENT_STATUS_FAIL , msg:'Failed'});
								}
						} else {
								callback({status: steamwizard.EVENT_STATUS_FAIL , msg:'Failed'});

								if(result.bad_token)
								   steamwizard.revokeToken();
						}
				});
			}
        },
        
        getFloatValue: function(inspectLink, callback) {
			var shortLink = steamwizard.getShortInspectLink(inspectLink);
			var cache = steamwizard.getFloatValueCache();
			if (shortLink != null && cache[shortLink]){
				callback({status: steamwizard.EVENT_STATUS_DONE , floatvalue: cache[shortLink]});
			}else{
				csgozone.market(inspectLink, function(data) {
					if(data.success === true) {
						steamwizard.port.postMessage({msg: 'storeItem', namespace: NAMESPACE_MARKET_INSPECT, key: shortLink, value: data.wear.toFixed(15)});
					   callback({status: steamwizard.EVENT_STATUS_DONE , floatvalue:data.wear.toFixed(15)});
					} else {
					   callback({status: steamwizard.EVENT_STATUS_FAIL , msg:'Failed'});
						
					   if(data.bad_token)
						  steamwizard.revokeToken();
					}
				});
			}
        },
		
		getShortInspectLink : function(inspectLink){
			var reg = /steam:\/\/rungame\/730\/76561202255233023\/\+csgo_econ_action_preview...[M|S].*A(.*)D.*/g;
			var match = reg.exec(inspectLink);
			if (match)
				return (match[1]);
			else
				return null;
		},
        
        getFloatValueCache: function() {
            return storage[NAMESPACE_MARKET_INSPECT];
        },
        
        getScreenshotCache: function() {
            return storage[NAMESPACE_SCREENSHOT];
        }
    };
})();