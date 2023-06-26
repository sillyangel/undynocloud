define(['amd/lib/knockout', 'viewmodels/optionsViewModel', 'viewmodels/pollViewModel', 'viewmodels/statusViewModel'], function(ko, OptionsViewModel, PollViewModel, StatusViewModel){
    var BrowserActionViewModel = function() {
        this.optionsViewModel = new OptionsViewModel();
        this.statusViewModel = new StatusViewModel();
    };

    return BrowserActionViewModel;
});