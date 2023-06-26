/**
 * Created by alexandr.parkhomenko on 22.07.2014.
 */
var dyKnowBlockPage = {

    observer: null,
    target : null,
    blocked : null,

    getObserver : function() {

        if (dyKnowBlockPage.observer) {
            return dyKnowBlockPage.observer;
        }

        dyKnowBlockPage.observer = new MutationObserver(function() {
            if (dyKnowBlockPage.target.style.display !== "none" && dyKnowBlockPage.blocked) {
                dyKnowBlockPage.target.style.display = "none";
            }
        });

        return dyKnowBlockPage.observer;
    },


    getTarget : function () {
        if (dyKnowBlockPage.target) {
            return dyKnowBlockPage.target;
        }

        dyKnowBlockPage.target = document.getElementsByTagName('html')[0];

        return dyKnowBlockPage.target;
    },


    setBlocked : function (blocked) {

        var target = dyKnowBlockPage.getTarget(),
            observer = dyKnowBlockPage.getObserver();

        if (blocked) {
            dyKnowBlockPage.blocked = true;
            target.style.display = "none";
            observer.observe(target, { attributes : true, attributeFilter : ['style'] });
        } else {
            observer.disconnect();
            dyKnowBlockPage.blocked = false;
            target.style.display = "";
        }

    }
};