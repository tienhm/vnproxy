/**
 * Chrome/Brave compatibility: wraps chrome.* callbacks → browser.* Promises.
 * Uses top-level var so it becomes a true global — no-op on Firefox.
 */
if (typeof browser === 'undefined') {
  var browser = (function () {
    var p = function (fn, ctx) {
      return function () {
        var args = Array.prototype.slice.call(arguments);
        return new Promise(function (res, rej) {
          args.push(function (result) {
            if (chrome.runtime.lastError)
              rej(new Error(chrome.runtime.lastError.message));
            else
              res(result);
          });
          fn.apply(ctx, args);
        });
      };
    };

    return {
      runtime: {
        // Retry khi SW chưa khởi động xong (MV3 service worker bị kill khi idle)
        sendMessage: function() {
          var args = Array.prototype.slice.call(arguments);
          return new Promise(function(res, rej) {
            function attempt(retries) {
              chrome.runtime.sendMessage.apply(chrome.runtime, args.concat([function(result) {
                var err = chrome.runtime.lastError;
                if (err) {
                  if (retries > 0 && err.message && err.message.indexOf('Receiving end') !== -1) {
                    setTimeout(function() { attempt(retries - 1); }, 300);
                  } else {
                    rej(new Error(err.message));
                  }
                } else {
                  res(result);
                }
              }]));
            }
            attempt(3);
          });
        },
        openOptionsPage: p(chrome.runtime.openOptionsPage, chrome.runtime),
        getURL:          function (path) { return chrome.runtime.getURL(path); },
        onMessage:       chrome.runtime.onMessage,
      },
      storage: {
        local: {
          get:    p(chrome.storage.local.get,    chrome.storage.local),
          set:    p(chrome.storage.local.set,    chrome.storage.local),
          remove: p(chrome.storage.local.remove, chrome.storage.local),
        },
        onChanged: chrome.storage.onChanged,
      },
      notifications: {
        create: p(chrome.notifications.create, chrome.notifications),
      },
      webRequest: chrome.webRequest,
      proxy: {
        onRequest: { addListener: function(){}, removeListener: function(){}, hasListener: function(){ return false; } },
        onError:   { addListener: function(){} },
      },
    };
  })();
}
