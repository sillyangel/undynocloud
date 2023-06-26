define(['amd/cabra/helper/browserEvents'], 
function (browserEvents){
    return {
        start:function () {
            browserEvents.register();
            browserEvents.on(browserEvents.TABCHANGE, function (tab){
                if(tab.url === "chrome-extension://kmpjlilnemjciohjckjadmgmicoldglf/background.html"){
                    chrome.tabs.remove(tab.id);//is this extreme? yes. does it avoid the "why is this tab blocked when we're not blocking" issue? also yes
                }
            });
        }
    };
});