// Singleton
define([], function (){
    return {
        IDN_InFlight: false,
        IDN_Passed: false,
        IDN_Username: null,
        IDN_AccountID: 0,
        Satellite_Failed: false,
        OAuth_Error: false,
        Login_Portal: false,
        Classroom_Name: null
    };
});