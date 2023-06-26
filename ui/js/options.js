/**
 * Created by mwoodsmall on 9/12/14.
 */
var isSending = false;
function sendLogs(e) {
    //do stuff here
    //check to make sure all required fields are there!
    $('#error').hide();
    if(!isSending && isValid(e)){
        e.preventDefault();
        isSending = true;
        $('progress').show();
        $('.progress-message').show();
        $('body').addClass('loading');
        var startDate = new Date($('#startdate').val()),
            endDate = new Date($('#enddate').val()),
            offset = startDate.getTimezoneOffset() / 60;

        startDate.setHours(startDate.getHours() + offset);
        endDate.setHours(endDate.getHours() + offset);

        var message = {
            "sendlogs": {
                "options": {"username": $('#username').val(), "institution": $('#institution').val(), "email": $('#email').val(), "notes": $('#notes').val()  },
                "startDate": startDate.toJSON(),
                "endDate": endDate.toJSON()
            }
        };

        chrome.runtime.sendMessage(message, function (response) {
            if (!response) {
                $('#error-msg').text('Unexpected response trying to send logs. Please try again. If this problem persists, please contact Dyknow support.');
                $('#error').show();
            } else if (response.error) {
                var error = (response.error || {}).message ||
                    'Unknown error trying to send logs. Please try again. If this problem persists, please contact Dyknow support.';
                $('#error-msg').text(error);
                $('#error').show();
            }
            reset();
        });
    } else if(isSending){
        e.preventDefault();
    }
}

function reset(){
    $('form').removeClass('invalid');
    $('#dateError').hide();
	chrome.identity.getProfileUserInfo(function (userInfo){
		$('#username').val(userInfo.email);
		$('#username').prop('disabled', true);
	});
    $('#institution').val('');
    $('#email').val('');
    $('#notes').val('');
    $('body').removeClass('loading');
    isSending = false;
    var now = new Date();
    var min = new Date();
    min.setDate(now.getDate() - 7);
    setMinAndMax(['enddate', 'startdate'], min, now);
}

function isValid(e){
    var valid = document.getElementById('username').validity.valid && document.getElementById('institution').validity.valid && document.getElementById('enddate').validity.valid && document.getElementById('notes').validity.valid && document.getElementById('startdate').validity.valid;
    if(!valid) {
        $('form').addClass('invalid');
    }
    var validDate =  document.getElementById('enddate').valueAsDate  >= document.getElementById('startdate').valueAsDate;
    if(!validDate){
        $('#dateError').show();
    } else {
        $('#dateError').hide();
    }

    if(valid && !validDate){
        //must prevent from drying to submit
        //since html5 validity won't stop it here
        e.preventDefault();
    }
    return valid && validDate;
}


function setMinAndMax(ids, min, max){
    var maxYear = max.getFullYear(),
        minYear = min.getFullYear(),
        maxDate = max.getDate().toString().length === 1 ? "0"+max.getDate().toString() : max.getDate().toString(),
        minDate = min.getDate().toString().length === 1 ? "0"+min.getDate().toString() : min.getDate().toString(),
        maxMonth = (max.getMonth()+1).toString().length === 1 ? "0"+(max.getMonth()+1).toString() : (max.getMonth()+1).toString(),
        minMonth = (min.getMonth()+1).toString().length === 1 ? "0"+(min.getMonth()+1).toString() : (min.getMonth()+1).toString(),
        minDateString=minYear+'-'+minMonth+'-'+minDate,
        maxDateString=maxYear+'-'+maxMonth+'-'+maxDate;

    $('#enddate').val(maxYear+'-'+maxMonth + '-'+ maxDate);
    $('#startdate').val(minYear+'-'+minMonth + '-'+ minDate);

    ids.forEach(function(id){
        var element = document.getElementById(id);
        element.setAttribute("max", maxDateString);
        element.setAttribute("min", minDateString);
    });
}


reset();

chrome.runtime.onMessage.addListener(function (request) {
    var topic = Object.keys(request)[0];
    switch (topic) {
        case 'updateLogStatus':
            var total = request[topic].total,
                current = request[topic].current,
                message = request[topic].message;

            $('progress').attr('max', total);
            $('progress').val(current);
            $('.progress-message').text(message);

            break;
    }
    return true;
});

document.getElementById('send').addEventListener('click', sendLogs);