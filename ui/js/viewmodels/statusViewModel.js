define([
    'amd/lib/knockout','amd/mixins/statusMixin', 'amd/sandbox',
    'amd/utils/extensionRestarter'],
function(
    ko, Status, Sandbox,
    restarter
    ){
    var StatusViewModel = function() {
        var _this = this,
            sandbox = new Sandbox().init();
        this.loaded = ko.observable(false);
        this.defaultStatuses = [
            new Status({order:1, color: 'green', text: 'I get it', weight:100}),
            new Status({order:2, color: 'yellow', text: 'I\'m not sure', weight:50}),
            new Status({order:3, color: 'red', text: "I don't get it, yet", weight:0})
        ];
        this.conversation_id = false;
        this.isWindow = false;
        this.statusOptions = ko.observableArray(this.defaultStatuses);
        this.selectedStatus = ko.observable(new Status());
        this.request = {};
        this.sendStatus = function(status){
            if (_this.selectedStatus() && _this.selectedStatus().showMask()) {
                _this.selectedStatus().showMask(false);
            }
            
            _this.selectedStatus(status);
            _this.selectedStatus().showMask(true);
            chrome.storage.local.set({status: status});
            setTimeout(function(){
                _this.selectedStatus().showMask(false);
                if(_this.isWindow){
                    window.close();
                }
            }, 500);
            sandbox.publish('statusUpdated', {status: status, conversation_id: _this.conversation_id});
        };
        this.getClassForStatus = function(status){
            if(status.order ===1){
                return 'understand';
            } else if(status.order === 2){
                return 'unsure';
            } else if(status.order === 3){
                return 'dontunderstand';
            } else {
                return 'unknown';
            }
        };
        this.getFontAwesomeClassForStatus = function(status){
            if(status.order ===1){
                return "fa-check-circle";
            } else if(status.order === 2){
                return "fa-adjust fa-rotate-90";
            } else if(status.order === 3){
                return "fa-times-circle-o";
            } else {
                return "fa-ellipsis-h";
            }
        };

        chrome.storage.local.get('status',function(status){
            if(status.status){
                _this.selectedStatus(new Status(status.status));
            }
        });

        //
        // Health Check
        //
        this.healthCheckStarted = ko.observable(false);
        this.healthCheckCodeText = ko.observable("");
        this.healthCheckButtonText = ko.observable("Okay"); // Alternates between "Okay" and "Loading..."
        this.healthCheckIssueButtonText = ko.observable("Notify Admin");  // Action button when an issue is detected
        this.healthCheckIssue = ko.observable("");
        this.healthCheckResolution = ko.observable("");
        this.issueDetected = ko.observable(false);
        this.showActionButton = ko.observable(true);
        this.selectableStudents = ko.observableArray();
        this.selectableStudentsAccountIds = ko.observableArray();
        this.selectedStudent = ko.observable();
        this.selectedStudentAccountId = ko.observable();
        this.notifyAdminState = ko.observable(false);
        this.notifyHeader = ko.observable("Notify Admin");
        this.notifyMessage = ko.observable("This will notify your admin");
        this.enableButton = ko.observable(false);
        this.secondaryIssue = ko.observable(false);
        this.healthCheckSecondaryIssue = ko.observable("");
        this.healthCheckSecondaryResolution = ko.observable("");
        this.showSelectableStudents = ko.observableArray(false);
        this.showNotifyMessage = ko.observable(false);
        this.connected = ko.observable(false);
        this.popupHeight = ko.observable("190px");
        this.issueHeight = ko.observable();
        this.cancelOrDoneText = ko.observable("Cancel");
        this.InternetOrServerIssue = ko.observable(false);
        this.unknownIssue = ko.observable(false);
        this.needReinstall = ko.observable(false);
        this.restartDyknowButtonText = ko.observable("Restart Dyknow");
        this.sendingLogs = ko.observable(false);
        this.studentSelected = ko.observable(false);
        this.validating = ko.observable(false);
        this.healthCheckInputFocused = ko.observable(false);

        var codeResponse = null;
        var issue = null;


        var ADMIN_NOTIFIED_ISSUE = "Success";
        var ADMIN_NOTIFIED_RESOLUTION = "Your admin has been notified.";

        var SERVER_ERROR_ISSUE = "Server Error";
        var SERVER_ERROR_RESOLUTION = "Please contact Dyknow support.";

        var OAUTH_SERVER_ISSUE = "Server Error";
        var OAUTH_SERVER_RESOLUTION = "It looks like Dyknow is having trouble phoning home. Would you like to notify your School Admin?";

        var SAT_SERVER_ISSUE = "Server Error";
        var SAT_SERVER_RESOLUTION = "It looks like Dyknow is having trouble phoning home. Would you like to notify your School Admin?";

        var UNKNOWN_ISSUE_ISSUE = "Unknown Issue";
        var UNKNOWN_ISSUE_RESOLUTION = "Please click 'Restart Dyknow.' If this problem persists, contact Dyknow support.";

        var NEED_REINSTALL_ISSUE = "Extension Not Responding";
        var NEED_REINSTALL_RESOLUTION = "Please click 'Restart Dyknow.' If this problem persists, reinstall the extension.";

        var NOT_IN_DYKNOW_ISSUE = "User Does Not Exist in Dyknow";
        var NOT_IN_DYKNOW_RESOLUTION = "This student is logging in as {0}, but this username is not in Dyknow. This code was generated for {1}.";

        var RESTRICTED_NETWORK_ISSUE = "Connected to Restricted Network";
        var RESTRICTED_NETWORK_RESOLUTION = "This device is connected to a network outside of the allowed IP Address range. Please connect to an allowed network.";

        var NOT_ASSIGNED_ISSUE = "Logged in as Someone Else";
        var NOT_ASSIGNED_RESOLUTION = "This code was generated for {0}, but the current signed in user is {1}. \r\n\r\n Please have the user log in correctly or contact your Dyknow Admin.";

        // Punted
        var OUTSIDE_MONITORING_HOURS_ISSUE = "Outside of Monitoring Hours";
        var OUTSIDE_MONITORING_HOURS_RESOLUTION = "This device cannot be monitored outside of allowed monitoring hours. Please try again during normal monitoring hours or contact your Dyknow Admin.";

        var NO_STUDENTS_ASSIGNED_ISSUE = "No Students Assigned";
        var NO_STUDENTS_ASSIGNED_RESOLUTION = "There are no students assigned to this Health Check.";

        var CLASS_ENDED_ISSUE = "Class Ended";
        var CLASS_ENDED_RESOLUTION = "The class for this code has ended.";

        var NO_ISSUE_DETECTED_ISSUE = "No Issues Detected";
        var NO_ISSUE_DETECTED_RESOLUTION = "Waiting to join class. Would you like to restart Dyknow?";

        var STUDENT_IN_CLASS_ISSUE = "Student In Class";
        var STUDENT_IN_CLASS_RESOLUTION = "Student currently in {0}.";

        this.healthCheckCodeStatus = ko.pureComputed(function() {
            return this.healthCheckCodeText() == "" ? "heathCheckCodeEmpty" : "healthCheckCodePopulated";
        }, this);

        this.somethingNotWorkingOrOther = ko.pureComputed(function() {
            return this.issueDetected() == true || this.healthCheckStarted() == true? "doneOrCancel" : "snw";
        }, this);

        this.studentSelectedStatus = ko.pureComputed(function() {
            _this.studentSelected(true);
            _this.selectedStudentAccountId(_this.selectableStudentsAccountIds()[_this.selectableStudents().indexOf(_this.selectedStudent())]);
            return this.selectedStudent() == null ? "heathCheckCodeEmpty" : "healthCheckCodePopulated";
        }, this);

        this.noInternetBackground = ko.pureComputed(function() {
            return this.connected() == false && !_this.healthCheckStarted() && !_this.issueDetected() && !_this.notifyAdminState()? "white-bg" : "gray-bg";
        }, this);

        this.restartDyknowStatus = ko.pureComputed(function() {
            return this.sendingLogs() == true ? "restartDisabled" : "restartEnabled";
        }, this);

        this.startHealthCheck = function() {
            this.loaded(false);
            this.healthCheckStarted(true);
            
            _this.healthCheckInputFocused(true);
            //document.getElementById("healthCheckCode").focus();
        };
        this.cancelHealthCheck = function() {
            _this.validating(false);
            _this.popupHeight("190px");
            _this.loaded(true);
            _this.cancelOrDoneText("Cancel");
            _this.healthCheckStarted(false);
            _this.issueDetected(false);
            _this.healthCheckButtonText("Okay");
            _this.notifyAdminState(false);
            clearTimeout(_this.codetimeout);
        };

        this.checkConnection = function() {
            if (!_this.healthCheckStarted() || !_this.issueDetected() || !_this.notifyAdminState()) {
                if (window.navigator.onLine) {
                    _this.connected(true);
                }
                else {
                    _this.connected(false);
                }
            }
        };

        this.reset = function() {
            _this.notifyAdminState(false);
            _this.cancelOrDoneText("Cancel");
            _this.showActionButton(false);
            _this.secondaryIssue(false);
            _this.showNotifyMessage(false);
            _this.selectedStudent(null);
            _this.showSelectableStudents(false);
            _this.studentSelected(false);
            _this.InternetOrServerIssue(false);
            clearTimeout(_this.codetimeout);
        };

        this.getHealthCheckTexts = function(response) {
            clearTimeout(_this.codetimeout);
            codeResponse = response; 
            _this.reset();
            _this.issueDetected(true);
            _this.selectableStudents(response.students.map(function(student) { return student.first_name + " " + student.last_name; }));
            _this.selectableStudentsAccountIds(response.students.map(function(student) { return student.account_id; }));
            if (response.IDN.Login_Portal) {
                _this.showActionButton(true);
                _this.healthCheckIssue(OAUTH_SERVER_ISSUE);
                _this.healthCheckResolution(OAUTH_SERVER_RESOLUTION);
                _this.resize();
                issue = 2;
            }
            else if (response.IDN.OAuth_Error) {
                _this.showActionButton(true);
                _this.healthCheckIssue(OAUTH_SERVER_ISSUE);
                _this.healthCheckResolution(OAUTH_SERVER_RESOLUTION);
                _this.resize();
                issue = 2;
            }
            else if (response.resolution == 1) { // IP restrictions
                var emails = response.students.map(function(item) { return item.email; });
                _this.healthCheckIssue(RESTRICTED_NETWORK_ISSUE);
                _this.healthCheckResolution(RESTRICTED_NETWORK_RESOLUTION);
                _this.showActionButton(true);
                if (response.IDN.IDN_Passed && !(emails.includes(response.IDN.IDN_Username))) {
                    _this.secondaryIssue(true);
                    _this.healthCheckSecondaryIssue(NOT_ASSIGNED_ISSUE);
                    var assignedUsers = _this.formatStudentListEmails(response.students);
                    var resoltion = "This code was generated for " + assignedUsers + ", but the current signed in user is " + response.IDN.IDN_Username +". \r\n\r\n Please have the user log in correctly or contact your Dyknow Admin.";
                    _this.healthCheckSecondaryResolution(resoltion);
                    _this.showActionButton(false);
                    _this.cancelOrDoneText("Done");
                    _this.resize();
                    issue = 8;
                }
                else if (!response.IDN.IDN_Passed) {
                    _this.secondaryIssue(true);
                    _this.healthCheckSecondaryIssue(NOT_IN_DYKNOW_ISSUE);
                    var users = _this.formatStudentListEmails(response.students);
                    var resoltion = "This student is logging in as " + response.IDN.IDN_Username + ", but this email is not in Dyknow. This code was generated for " + users + ".";
                    _this.healthCheckSecondaryResolution(resoltion);
                    _this.resize();
                    issue = 811; // 8 + 11 = 811, we want to notify the admin of both issues
                }
                else {
                    _this.resize();
                    issue = 8; // IP restrictions
                }
            }
            else if (!response.IDN.IDN_Passed) {
                _this.showActionButton(true);
                _this.healthCheckIssue(NOT_IN_DYKNOW_ISSUE);
                var users = _this.formatStudentListEmails(response.students);
                var resoltion = "This student is logging in as " + response.IDN.IDN_Username + ", but this email is not in Dyknow. This code was generated for " + users + ".";
                _this.healthCheckResolution(resoltion);
                _this.resize();
                issue = 11;
            }
            else if (response.students.length == 0) {
                _this.healthCheckIssue(NO_STUDENTS_ASSIGNED_ISSUE);
                _this.healthCheckResolution(NO_STUDENTS_ASSIGNED_RESOLUTION);
            }
            else if (response.code == "Server Error" || response == null) {
                _this.healthCheckIssue(SERVER_ERROR_ISSUE);
                _this.healthCheckResolution(SERVER_ERROR_RESOLUTION);
                _this.resize();
            }
            else if (response.IDN.IDN_Passed) {
                var emails = response.students.map(function(item) { return item.email; });
                if (response.class_status != 'open') {
                    _this.healthCheckIssue(CLASS_ENDED_ISSUE);
                    _this.healthCheckResolution(CLASS_ENDED_RESOLUTION);
                    _this.showActionButton(false);
                    _this.cancelOrDoneText("Done");
                    _this.resize();
                }
                else if (!(emails.includes(response.IDN.IDN_Username))) {
                    _this.healthCheckIssue(NOT_ASSIGNED_ISSUE);
                    var assignedUsers = _this.formatStudentListEmails(response.students);
                    var resoltion = "This code was generated for " + assignedUsers + ", but the current signed in user is " + response.IDN.IDN_Username +". \r\n\r\n Please have the user log in correctly or contact your Dyknow Admin.";
                    _this.healthCheckResolution(resoltion);
                    _this.showActionButton(false);
                    _this.resize();
                }
                else if (response.IDN.Classroom_Name != null && response.IDN.IDN_Passed && response.class_status == 'open') {
                    _this.healthCheckIssue(STUDENT_IN_CLASS_ISSUE);
                    var resolution = "Student currently in " +  response.IDN.Classroom_Name + ".";
                    _this.healthCheckResolution(resolution);
                    _this.showActionButton(false);
                    _this.cancelOrDoneText("Done");
                    _this.resize();
                    var request = {
                        "code": codeResponse.health_check_code,
                        "issue": 0, // student appeared in class
                        "roster_id": codeResponse.roster_id,
                        "account_ids": [codeResponse.IDN.IDN_AccountID],
                        "corrected_email": null,
                        "student_wan_address": null
                    };
                    sandbox.publish("codeNotify", request);
                }
                else if (response.IDN.Satellite_Failed) {
                    _this.showActionButton(true);
                    _this.healthCheckIssue(SAT_SERVER_ISSUE);
                    _this.healthCheckResolution(SAT_SERVER_RESOLUTION);
                    _this.resize();
                    issue = 4;
                }
                else if (response.IDN.Classroom_Name == null && response.IDN.IDN_Passed && response.class_status == 'open')
                {
                    var emails = response.students.map(function(item) { return item.email; });
                    if (emails.includes(response.IDN.IDN_Username)) {
                        _this.healthCheckIssue(UNKNOWN_ISSUE_ISSUE);
                        _this.healthCheckResolution(UNKNOWN_ISSUE_RESOLUTION);
                        _this.showActionButton(true);
                        _this.unknownIssue(true);
                        _this.resize();
                    }
                }
                else {
                    _this.healthCheckIssue(UNKNOWN_ISSUE_ISSUE);
                    _this.healthCheckResolution(UNKNOWN_ISSUE_RESOLUTION);
                    _this.showActionButton(true);
                    _this.unknownIssue(true);
                    _this.resize();
                }
            }
            else if (response.IDN.Satellite_Failed) {
                _this.showActionButton(true);
                _this.healthCheckIssue(SAT_SERVER_ISSUE);
                _this.healthCheckResolution(SAT_SERVER_RESOLUTION);
                _this.resize();
                issue = 4;
            }
            else {
                _this.healthCheckIssue(NO_ISSUE_DETECTED_ISSUE);
                _this.healthCheckResolution(NO_ISSUE_DETECTED_RESOLUTION);
            }
        };

        this.formatStudentListEmails = function(studentList) {
            var studentEmails = studentList.map(function(student) { return student.email; });
            var formattedStudentList = "";
            if (studentEmails.length == 1) {
                if (studentEmails[0] == undefined) {
                    return this.formatFullName(studentList[0]) + " (No Email)";
                }
                else {
                    return studentEmails[0];
                }
            }
            if (studentEmails.length == 2) {
                if (studentEmails[0] == undefined) {
                    if (studentEmails[1] == undefined) {
                        return this.formatFullName(studentList[0]) + " (No Email) and " + this.formatFullName(studentList[1]) + " (No Email)";
                    }
                    return this.formatFullName(studentList[0]) + " (No Email) and " + studentEmails[1];
                }
                if (studentEmails[1] == undefined) {
                    return studentEmails[0] + " and " + this.formatFullName(studentList[1]) + " (No Email)";
                }
                else {
                    return studentEmails[0] + " and " + studentEmails[1];
                }
            }
            var index = 0;
            while (index <= (studentEmails.length - 1)) {
                if (index != (studentEmails.length - 1)) {
                    if (studentEmails[index] == undefined) {
                        formattedStudentList = formattedStudentList + this.formatFullName(studentList[index]) + " (No Email), ";
                    }
                    else {
                        formattedStudentList = formattedStudentList + studentEmails[index] + ", ";
                    }
                    index = index + 1;
                }
                else {
                    if (studentEmails[index] == undefined) {
                        formattedStudentList = formattedStudentList + "and " +  this.formatFullName(studentList[index]) + " (No Email)";
                    }
                    else {
                        formattedStudentList = formattedStudentList + "and " +  studentEmails[index];
                    }
                    index = index + 1;
                }
            }
            return formattedStudentList;
        };

        this.formatFullName = function(student) {
            return student.first_name + " " + student.last_name;
        };

        this.formatStudentListFullName = function(studentList) {
            var studentFullNames = studentList.map(function(student) { return student.first_name + " " + student.last_name; });
            var formattedStudentList = "";
            if (studentFullNames.length == 1) {
                return studentFullNames[0];
            }
            if (studentFullNames.length == 2) {
                return studentFullNames[0] + " and " + studentFullNames[1];
            }
            var index = 0;
            while (index <= (studentFullNames.length - 1)) {
                if (index != (studentFullNames.length - 1)) {
                    formattedStudentList = formattedStudentList + studentFullNames[index] + ", ";
                    index = index + 1;
                }
                else {
                    formattedStudentList = formattedStudentList + "and " +  studentFullNames[index];
                    index = index + 1;
                }
            }
            return formattedStudentList;
        };

        this.delayButtonText = function() {
            clearTimeout(_this.codetimeout);
            //_.delay(_this.changeButtonText, 2000, "Okay");
            setTimeout(function() {
                _this.changeButtonText("Okay");
            }, 2000);
        };

        this.changeButtonText = function(text) {
            _this.healthCheckButtonText(text);
            _this.validating(false);
        };

        this.onUnresponsiveExtension = function () {
            _this.issueDetected(true);
            _this.healthCheckIssue(NEED_REINSTALL_ISSUE);
            _this.healthCheckResolution(NEED_REINSTALL_RESOLUTION);
            _this.restartDyknowButtonText("Restart Dyknow");
            _this.showActionButton(true);
            _this.needReinstall(true);
            _this.resize();
        };

        this.validateHealthCheckCode = function() {
            _this.reset();
            _this.validating(true);
            if (this.healthCheckCodeText().length != 0) {
                if (this.healthCheckCodeText().length >= 4) {
                    this.healthCheckButtonText("Loading...");
                    sandbox.publish("codeEntered", { code: this.healthCheckCodeText()});
                    _this.codetimeout = setTimeout(function () {
                        clearTimeout(_this.codetimeout);//effective noop
                        _this.healthCheckButtonText("Waiting...");
                        _this.codetimeout = setTimeout(function () {
                            clearTimeout(_this.codetimeout);//effective noop
                            _this.healthCheckButtonText("Loading...");
                            _this.codetimeout = setTimeout(function () {
                                _this.codetimeout = setTimeout(_this.onUnresponsiveExtension, 5000);
                            }, 10000);
                        }, 10000);
                    }, 10000);
                }
                else {
                    this.healthCheckButtonText("Loading...");
                    this.delayButtonText();
                }
            }
        };

        this.displayNotifyAdmin = function() {
            this.notifyAdminState(true);
            _this.showSelectableStudents(true);
            _this.notifyHeader("Student to Report");
            if (_this.healthCheckIssue() == OAUTH_SERVER_ISSUE) {
                this.issue = 2;
            }
            _this.resize();

        };

        this.resize = function() {
            // DOM structure
            // [                 popup                    ]
            //
            //    [            healthCheck             ]   
            // 
            //       [   healthcheckIssueWrapper   ]
            //
            //    [            /healthCheck             ] 
            //
            //    [      somethingNotWorking: 28px      ]
            //
            // [                /popup                    ]
            //
            // Popup height = healthCheck + somethingNotWorking (28px) + healthCheckIssueWrapper (25px)
            if (_this.healthCheckStarted()) {
                var height = document.getElementById("healthCheck").offsetHeight + 48;
                if (_this.showActionButton() == true && _this.notifyAdminState() != true) {
                    height = height - 10; // buttons add 10px of margin
                }
                if (_this.showSelectableStudents() == true) {
                    height = height - 10; // buttons add 10px of margin
                }
                _this.popupHeight(height.toString() + "px");
            }
        };

        this.notifyAdmin = function() {
            if (this.selectedStudent() != null) {
                var accountId = null;
                if (codeResponse.IDN.IDN_AccountID == 0) {
                    accountId = _this.selectedStudentAccountId();
                }
                else {
                    accountId = codeResponse.IDN.IDN_AccountID;
                }
                var request = {
                    "code": codeResponse.health_check_code,
                    "issue": issue,
                    "roster_id": codeResponse.roster_id,
                    "account_ids": [accountId],
                    "corrected_email": null,
                    "student_wan_address": null
                };
                if (request.issue == 8) {
                    request.student_wan_address = codeResponse.ip_address;
                }
                if (request.issue == 811) {
                    request.student_wan_address = codeResponse.ip_address;
                    request.corrected_email = codeResponse.IDN.IDN_Username;
                }
                if (request.issue == 11) {
                    request.corrected_email = codeResponse.IDN.IDN_Username;
                }
                sandbox.publish("codeNotify", request);
            }
        };

        this.codeNotifySuccess = function() {
            if (_this.notifyAdminState()) {
                _this.showSelectableStudents(false);
                _this.showNotifyMessage(true);
                _this.notifyHeader(ADMIN_NOTIFIED_ISSUE);
                _this.notifyMessage(ADMIN_NOTIFIED_RESOLUTION);
                _this.showActionButton(false);
                _this.cancelOrDoneText("Done");
                _this.resize();
            }
        };

        this.codeNotifyFailure = function() {
            if (_this.notifyAdminState()) {
                _this.showSelectableStudents(false);
                _this.showNotifyMessage(true);
                _this.notifyHeader(SERVER_ERROR_ISSUE);
                _this.notifyMessage(SERVER_ERROR_RESOLUTION);
                _this.showActionButton(false);
                _this.resize();
            }
        };

        this.noInternetServerIssue = function () { // no internet connection
            clearTimeout(_this.codetimeout);
            if (_this.healthCheckStarted() && _this.validating()) {
                _this.notifyAdminState(true);
                _this.cancelOrDoneText("Cancel");
                _this.showActionButton(false);
                _this.secondaryIssue(false);
                _this.showNotifyMessage(true);
                _this.showSelectableStudents(false);
                _this.issueDetected(true);
                _this.InternetOrServerIssue(true);
                _this.notifyHeader(SERVER_ERROR_ISSUE);
                _this.notifyMessage(SERVER_ERROR_RESOLUTION);
                _this.resize();
            }
        };

        this.errorServerIssue = function() { //server error
            clearTimeout(_this.codetimeout);
            if (_this.healthCheckStarted()) {
                _this.notifyAdminState(true);
                _this.cancelOrDoneText("Cancel");
                _this.showActionButton(false);
                _this.secondaryIssue(false);
                _this.showNotifyMessage(true);
                _this.showSelectableStudents(false);
                _this.issueDetected(true);
                _this.InternetOrServerIssue(true);
                _this.notifyHeader(SERVER_ERROR_ISSUE);
                _this.notifyMessage(SERVER_ERROR_RESOLUTION);
                _this.resize();
            }
        };

        this.sendLogsAndRestart = function() {
            if (_this.needReinstall()){
                restarter.restart();
                return;
            }
            var request = {
                health_check_code: codeResponse.health_check_code,
            };
            _this.sendingLogs(true);
            _this.restartDyknowButtonText("Processing...");

            sandbox.publish("sendLogsAndRestart", request);
        };

        this.enterPressed = function(data, event) {
            if (event.which == 13) //enter button
            {
                event.preventDefault();
                _this.validateHealthCheckCode();
            }
        };

        // Do this on startup, then run checkConnection every 3 seconds
        if (window.navigator.onLine) {
            this.connected(true);
        }
        else {
            this.connected(false);
        }
        setInterval(_this.checkConnection, 3000);

        sandbox.subscribe("codeenteredsuccess", _this.getHealthCheckTexts);
        sandbox.subscribe("codeenteredfailure", _this.delayButtonText);
        sandbox.subscribe("codeenterederror", _this.errorServerIssue);
        sandbox.subscribe("codeenterednointernet", _this.noInternetServerIssue);
        sandbox.subscribe("codenotifysuccess", _this.codeNotifySuccess);
        sandbox.subscribe("codenotifyfailure", _this.codeNotifyFailure);
    };
    return StatusViewModel;
});