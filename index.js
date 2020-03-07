
const AWS = require('aws-sdk');
const async = require('async');
const botName = "AWS-Infra-Start-Stop";
//const lambda = new AWS.Lambda({region: 'eu-west-2'});

const defaultRegion = 'eu-west-2';

const arg1 = 0;
const arg2 = 1;
const arg3 = 2;

const responseSuccessHeading = "\n#### ** Result : Success **\n";
const responseErrorHeading = "\n#### ** Result : Error **\n";

const responseStartStopTableHeader = "\n\n| **Instance ID** | **Tag:Name** | **Current State** | **Previous State** |\n";
const responseStatusTableHeader = "\n\n| **Instance ID** | **Tag:Name** | **Instance State** | **Public DNS** |\n";
const responseTableSeperator = "| :------------ |:---------------:| -----:|\n";

const commandUsage = "usage";
const commandHelp = "help";
const commandStatus = "status";
const commandStart = "start";
const commandStop = "stop";
const matterMostTokenToValidate = process.env.matterMostTokenToValidate;
const matterMost_channel_id = process.env.matterMost_channel_id;

const availableCommands = [commandUsage, commandHelp, commandStatus, commandStart, commandStop];
const validCommands = availableCommands.slice(2);

exports.handler = (event, context, callback) => {
  //console.log(matterMostTokenToValidate + " , "+matterMost_channel_id);
  console.log(event);
  var returnMessage = "";
  var responseObj = {"response_type": "in_channel", "text" : ""};
  var region = defaultRegion;
  var describedEc2InstancesData;

  const triggerWord = event['command'];
  const token = event['token'];
  const channel_id = event['channel_id'];

  //const triggerWord = event['trigger_word'];
  const user = event['user_name'];
  //var words = event['text'].split(triggerWord);
  //var words = words[1].trim().split(" ");

  const words = event['text'].trim().split(" ");
  const requestedBy = event['user_name'];

  const responseCommand = "####  Input Command : **_ " + triggerWord + " " + event['text']+" _** \n **_ Requested By : " + requestedBy + " _** \n" ;

  const commandLabels = {};
  commandLabels[commandHelp] =  "####  Available commands: `" + availableCommands.join(", ") + "`";
  commandLabels[commandUsage] = "\n| **Command** | **Description** | **Usage** |"
  +"\n| :------------ |:---------------:| -----:|"
  +"\n|help |Execute the help command without options to produce a list of commands that are usable with the help command.|"+triggerWord +" help|"
  +"\n|start |Execute the **start** command with options to start instances having user specified tag vaklue for tag in provided region. default region: eu-west-2|"
    +triggerWord +" start (tagName=tagValue) (region)|"
  +"\n|stop |Execute the **stop** command with options to stop instances having user specified tag vaklue for tag  in provided region. default region: eu-west-2|"
    +triggerWord +" stop (tagName=tagValue) (region) |"
  +"\n|status |Execute the **status** command with options to get status of instances having user specified tag value for tag in provided region. default region: eu-west-2|"
      +triggerWord +" status (tagName=tagValue) (region) |"

  // "####  Usage: ``" + triggerWord + " <command> <tag value for tag:Name> <region>`";
  commandLabels["commandDetails"] =  commandHelp + "\n" + commandUsage;

  function getCommandOptionsCount(options) {
    //console.log(options.length);
    return options.length;
  }

  var validateCommand = function(commandOptions, callback) {
    console.log("---- : "+ commandOptions);
    if (getCommandOptionsCount(commandOptions) == 1) {
      if (typeof commandLabels[commandOptions[arg1]] != 'undefined' ) {
        returnMessage += commandLabels[commandOptions[arg1]];
      } else {
        returnMessage += commandLabels[commandUsage];
      }
      console.log(returnMessage);
      callback(returnMessage, null);
    } else {
      callback(null, 'Proceed further');
    }
  }

  var describeEc2Instances = function(commandOptions, ec2, callback) {
    var tagInputs = commandOptions[arg2].trim().split("=");
    if (tagInputs.length != 2) {
      returnMessage = responseErrorHeading
          + "#### Invalid tag details. it should be (tagName=tagValue)" ;
      callback(returnMessage, null);
    } else {
      var tagName = tagInputs[0];
      var tagValue = tagInputs[1];
      var describeInstanceParams = {
        Filters : [{
          'Name': 'tag:'+tagName,
          'Values': [tagValue]
          }
        ]
      };

      ec2.describeInstances(describeInstanceParams, function(err, data){
        //console.log(data);
        if (err) {
          returnMessage = responseErrorHeading
              + "####  "+ err.message ;
          callback(returnMessage, null);
        } else if (data.Reservations.length < 1) {
          returnMessage = responseErrorHeading
            + "####  Instances not found in region " + region + ", pls check in another region by providing region";
          callback(returnMessage, null);
        } else {
          callback(null, data);
        }
      });
    }
  }

  function getEc2TagValue(instanceData, tagName) {
    var tagValue = "";
    console.log(JSON.stringify(instanceData.Tags));
    instanceData.Tags.some(function(tag) {
      if (tag.Key == tagName) {
        tagValue = tag.Value;

        return true;
      }
    });
    return tagValue;
  }

  function getEc2TagValueFromDescribedInstancesData(data, instanceId, tagName) {
    var tagValue = "";
    data.Reservations.some(function(reservation) {
      reservation.Instances.some(function(instance){
        if (instanceId == instance.InstanceId) {
          tagValue = getEc2TagValue(instance, "Name");
          return true;
        }
        if (tagValue != "") {
          return true;
        }
      });
    });

    return tagValue;
  }

  function buildStatusResponseMessage(data) {
    var message;
    message = responseSuccessHeading
      + responseStatusTableHeader
      + responseTableSeperator;

    data.Reservations.forEach(function(reservation) {
      reservation.Instances.forEach(function(instance){
        message += '| '+instance.InstanceId
          +' | '+getEc2TagValue(instance, "Name")
          +' | '+instance.State.Name
          +' | '+instance.PublicDnsName
          +' |\n';

      });
    });
    return message;
  }

  function buildStartStopTeminateResponseMessage(instances, describedInstancesData) {
    var message = responseSuccessHeading
      + responseStartStopTableHeader
      + responseTableSeperator;

    instances.forEach(function(instance) {
      message += ' | '+instance.InstanceId
       +' | '+getEc2TagValueFromDescribedInstancesData(describedInstancesData, instance.InstanceId, "Name")
       +' | '+instance.CurrentState.Name
       +' | '+instance.PreviousState.Name
       +' | \n';
    });

    return message;
  }

  var stopEc2Instances = function(instancesToStop, ec2, callback) {
    var returnMessage;
    if (instancesToStop.length == 0) {
      returnMessage = responseErrorHeading
          + "####  **No Instance to Stop**" ;
      callback(returnMessage, null);
    }

    ec2.stopInstances({InstanceIds : instancesToStop },function (err, data) {
      if (err) {
        returnMessage = responseErrorHeading
            + "####  "+ err.message ;
        callback(returnMessage, null);
      } else {
        returnMessage = buildStartStopTeminateResponseMessage(data.StoppingInstances, describedEc2InstancesData);
        console.log("stopEc2Instances : "+returnMessage);
        callback(null, returnMessage);
       }
    });
  }

  var startEc2Instances = function(instancesToStart, ec2, callback) {
    var returnMessage;
    if (instancesToStart.length == 0) {
      returnMessage = responseErrorHeading
          + "####   **No Instance to Start**" ;
      callback(returnMessage, null);
    }

    ec2.startInstances({InstanceIds : instancesToStart },function (err, data) {
      if (err) {
        returnMessage = responseErrorHeading
            + "####  "+ err.message ;
        callback(returnMessage, null);
      } else {
        returnMessage = buildStartStopTeminateResponseMessage(data.StartingInstances, describedEc2InstancesData);
        console.log("startEc2Instances : "+returnMessage);
        callback(null, returnMessage);
       }
    });
  }

  var terminateEc2Instances = function(instancesToTerminate, ec2, callback) {
    var returnMessage;
    if (instancesToTerminate.length == 0) {
      returnMessage = responseErrorHeading
          + "####   **No Instance to Terminate**" ;
      callback(returnMessage, null);
    }

    ec2.terminateInstances({InstanceIds : instancesToTerminate },function (err, data) {
      if (err) {
        returnMessage = responseErrorHeading
            + "####  "+ err.message ;
        callback(returnMessage, null);
      } else {
        returnMessage = buildStartStopTeminateResponseMessage(data.TerminatingInstances, describedEc2InstancesData);
        console.log("terminateInstances : "+returnMessage);
        callback(null, returnMessage);
       }
    });
  }

  var resumeAutoScalingProcesses = function(autoScalingGroupName, callback) {
    var autoscaling = new AWS.AutoScaling({region: region});
    var resumeAGProcessesParams = {
      AutoScalingGroupName: autoScalingGroupName,
      // omitting ScalingProcesses so that all process are suspended
    };

    autoscaling.resumeProcesses(resumeAGProcessesParams, function(err, data) {
      if (err) {
        returnMessage = responseErrorHeading
            + "####  "+ err.message ;
        callback(returnMessage, null);
      } else {
        callback(null, data);
      }
    });
  }

  var detachEc2InstancesFromAGAndResumeAGProcesses = function(autoScalingGroupName, instancesToDetach, autoscaling, callback) {
    var detachInstanceParams = {
      AutoScalingGroupName: autoScalingGroupName, /* required */
      ShouldDecrementDesiredCapacity: false, /* required */
      InstanceIds: instancesToDetach
    };
    autoscaling.detachInstances(detachInstanceParams, function(err, data) {
      if (err) {
        returnMessage = responseErrorHeading
            + "####  "+ err.message ;
        callback(returnMessage, null);
      } else {
        resumeAutoScalingProcesses(autoScalingGroupName, function(err, data) {
          if (err) {
            callback(err, null);
          } else {
            callback(null, data);
          }
        });
      }
    });
  }

  var startK8sNonMasterEc2InstancesInAG = function(autoscalingGroups, ec2, callback) {
    var totalAGCount = Object.keys(autoscalingGroups).length;
    var consolidatedMessage = "\n";
    var autoscaling = new AWS.AutoScaling({region: region});

    async.forEachOf(autoscalingGroups, function(agDetails, agName, callback) {
      var instancesToDetachAndTerminate = agDetails.instancesToTerminate;
      detachEc2InstancesFromAGAndResumeAGProcesses(agName, instancesToDetachAndTerminate, autoscaling, function(errMsg, data) {
        if(errMsg) {
          consolidatedMessage += "\n ### AutoScaling Group : " + agName + " : " + errMsg;
          callback();
        } else {
          terminateEc2Instances(instancesToDetachAndTerminate, ec2, function(errMsg, message) {
            if(errMsg) {
              consolidatedMessage += "\n ### AutoScaling Group : " + agName + " : " + errMsg;
              callback();
            } else {
              consolidatedMessage += "\n ### AutoScaling Group : " + agName + " : " + message;
              callback()
            }
          });
        }
      });
    }, function(err) {
        if (err) {
          consolidatedMessage += "\n"  + err;
          callback(null, consolidatedMessage);
        } else {
          console.log('Completed : startK8sNonMasterEc2InstancesInAG');
          console.log(consolidatedMessage);
          callback(null, consolidatedMessage);
        }
    });
  }

  var suspendAGProcessesAndStopEc2Instances = function(autoscalingGroups, ec2, callback) {
    var totalAGCount = Object.keys(autoscalingGroups).length;
    var consolidatedMessage = "\n";
    var autoscaling = new AWS.AutoScaling({region: region});

    var consolidatedMessage;

    async.forEachOf(autoscalingGroups, function(agDetails, agName, callback) {
      console.log('>>>>>>>')
      console.log(agName);

      var params = {
        AutoScalingGroupName: agName,
        // omitting ScalingProcesses so that all process are suspended
       };
       console.log(JSON.stringify(params));
       autoscaling.suspendProcesses(params, function(err, data) {
         if (err) {
           consolidatedMessage =  responseErrorHeading
               + "\n ###  AutoScaling Group : " + agName + " : " +err.message ;
           consolidatedMessage += "\n" + returnMessage;
           callback();
         } else {
           var instancesToStop = [];
           instancesToStop = agDetails.instancesToStop;

           stopEc2Instances(instancesToStop, ec2, function(err, message){
             if(err) {
               consolidatedMessage += "\n ###  AutoScaling Group : "  + agName + " : " + err;
               callback();
             } else {
               consolidatedMessage += "\n ###  AutoScaling Group : "  + agName + " : " + message;
               callback();
             }
           });
         }
      });
    }, function(err) {
        if (err) {
          consolidatedMessage += "\n" + err;
          callback(null, consolidatedMessage);
        } else {
          console.log('Completed : suspendAGProcessesAndStopEc2Instances');
          console.log(consolidatedMessage);
          callback(null, consolidatedMessage);
        }
    });
  }

  function commandValid(option) {
    var isValid = validCommands.indexOf(option) >= 0 ? true : false;
    return isValid;
  }

  function getValidInstancesToStart(data) {
    var instancesToStart = [];

    data.Reservations.forEach(function(reservation) {
      reservation.Instances.forEach(function(instance){
        if (instance.State.Name == 'stopped') {
          instancesToStart.push(instance.InstanceId)
        }
      });
    });
    return instancesToStart;
  }

  function ifEc2IsK8sNonMasterNode(instance) {
    var isEc2IsK8sNonMasterNode = false;
    instance.Tags.some(function(tag) {
      if (tag.Key == "k8s.io/role/node") {
        console.log('>>>>>> before ifEc2IsK8sNonMasterNode : returning true');
        isEc2IsK8sNonMasterNode = true;
        return isEc2IsK8sNonMasterNode;
      }
    });
    console.log('>>>>>> before ifEc2IsK8sNonMasterNode : returning false');
    return isEc2IsK8sNonMasterNode;
  }

  function getEc2AutoScalingGroupName(instance){
    var tagValue = "";
    instance.Tags.some(function(tag){
      if (tag.Key == "aws:autoscaling:groupName") {
        tagValue =  tag.Value;
        return true;
      }
    });
    return tagValue;
  }

  function getValidInstancesToStopOrStart(data, forAction) {
    var instances = {
      instancesWithOutAG : [],
      autoscalingGroups: {}
    };

    data.Reservations.forEach(function(reservation) {
      reservation.Instances.forEach(function(instance){
        if ((instance.State.Name == 'running' && forAction == commandStop) ||
            (instance.State.Name == 'stopped' && forAction == commandStart)) {

          var ec2AutoScalingGroupName = getEc2AutoScalingGroupName(instance);

          if(ec2AutoScalingGroupName) {
            
            if (forAction == commandStart && ifEc2IsK8sNonMasterNode(instance)) {
              if (!(ec2AutoScalingGroupName in instances.autoscalingGroups)) {
                instances.autoscalingGroups[ec2AutoScalingGroupName] = {instancesToTerminate: [], instancesToStop: []};
              }
              instances.autoscalingGroups[ec2AutoScalingGroupName].instancesToTerminate.push(instance.InstanceId);
            } else if (forAction == commandStop) {
              if (!(ec2AutoScalingGroupName in instances.autoscalingGroups)) {
                instances.autoscalingGroups[ec2AutoScalingGroupName] = {instancesToTerminate: [], instancesToStop: []};
              }
              instances.autoscalingGroups[ec2AutoScalingGroupName].instancesToStop.push(instance.InstanceId);
            } else {
              instances.instancesWithOutAG.push(instance.InstanceId);
            }
          } else {
            instances.instancesWithOutAG.push(instance.InstanceId);
          }

        }
      });
    });
    console.log('getValidInstancesToStopOrStart : '+ JSON.stringify(instances));
    return instances;
  }

  var executeCommand = function(commandOptions, callback) {
    if (getCommandOptionsCount(commandOptions) >= 2) {

      if (commandValid(commandOptions[arg1])) {

        (getCommandOptionsCount(commandOptions) == 3) ? region = commandOptions[arg3] : region = defaultRegion;

        var ec2 = new AWS.EC2({region: region});


        describeEc2Instances(commandOptions, ec2, function(err, data) {
          if(!err) {
            describedEc2InstancesData = data;
          }

          if(err) {
            responseObj.text = responseCommand + err
            callback(null, responseObj);

          } else if (commandOptions[arg1] === commandStatus) {

            var returnMessage = buildStatusResponseMessage(data);
            responseObj.text = responseCommand + returnMessage
            callback(null, responseObj);

          } else if (commandOptions[arg1] === commandStop) {
            var returnMessage = "\n";
            var instancesToStop = getValidInstancesToStopOrStart(data, commandStop);
            var toBeCompletedActions = 2;

            if (instancesToStop.instancesWithOutAG.length > 0) {
              stopEc2Instances(instancesToStop.instancesWithOutAG, ec2, function(err, message){
                toBeCompletedActions--;
                if(err) {
                  returnMessage += err;
                } else {
                  returnMessage += message;
                }
                if (toBeCompletedActions == 0) {

                  responseObj.text = responseCommand + returnMessage;
                  callback(null, responseObj);
                }
              });
            } else {
              returnMessage +=  responseErrorHeading
                  + "####  **No Instance to Stop with out AutoScaling Group**" ;

              toBeCompletedActions--;
              if (toBeCompletedActions == 0) {
                responseObj.text = responseCommand + returnMessage;
                callback(null, responseObj);
              }
            }

            if (Object.keys(instancesToStop.autoscalingGroups).length == 0) {
              returnMessage += responseErrorHeading
                  + "####  **No Instance to Stop with Auto Scaling Group**" ;

              toBeCompletedActions--;
              if (toBeCompletedActions == 0) {
                responseObj.text = responseCommand + returnMessage;
                callback(null, responseObj);
              }
            } else {
              suspendAGProcessesAndStopEc2Instances(instancesToStop.autoscalingGroups, ec2, function(err, message){
                toBeCompletedActions--;
                if(err) {
                  returnMessage += err;
                } else {
                  returnMessage += message;
                }
                if (toBeCompletedActions == 0) {
                  responseObj.text = responseCommand + returnMessage;
                  callback(null, responseObj);
                }
              });
            }
          } else if (commandOptions[arg1] === commandStart) {
            var returnMessage = "\n";
            var instancesToStart = getValidInstancesToStopOrStart(data, commandStart);
            var toBeCompletedActions = 2;
            console.log('++++++++++ In start ++++++++');
            console.log(JSON.stringify(instancesToStart));

            if (instancesToStart.instancesWithOutAG.length > 0) {
              startEc2Instances(instancesToStart.instancesWithOutAG, ec2, function(err, message){
                toBeCompletedActions--;
                if(err) {
                  returnMessage += err;
                } else {
                  returnMessage += message;
                }
                 console.log('1111 : '+toBeCompletedActions);
                if (toBeCompletedActions == 0) {
                  responseObj.text = responseCommand + returnMessage;
                  callback(null, responseObj);
                }
              });
            } else {
              returnMessage += responseErrorHeading
                  + "####  **No Instance to Start without Auto Scaling Group**" ;

              toBeCompletedActions--;
              console.log('000 : '+toBeCompletedActions);
              if (toBeCompletedActions == 0) {
                responseObj.text = responseCommand + returnMessage;
                callback(null, responseObj);
              }
            }

            if (Object.keys(instancesToStart.autoscalingGroups).length == 0) {
              returnMessage += responseErrorHeading
                  + "####  **No Instance (K8S Non Master Nodes) to Terminate & Start with Auto Scaling Group**" ;

              toBeCompletedActions--;
              console.log('222 : '+toBeCompletedActions);
              if (toBeCompletedActions == 0) {
                responseObj.text = responseCommand + returnMessage;
                callback(null, responseObj);
              }
            } else {
              startK8sNonMasterEc2InstancesInAG(instancesToStart.autoscalingGroups, ec2, function(err, message){
                toBeCompletedActions--;
                if(err) {
                  returnMessage += err;
                } else {
                  returnMessage += message;
                }
                if (toBeCompletedActions == 0) {
                  responseObj.text = responseCommand + returnMessage;
                  callback(null, responseObj);
                }
              });
            }
          }
        });
      } else {
        returnMessage += commandLabels[commandUsage];
        responseObj.text = returnMessage;
        callback(null, responseObj);
      }

    }
  }

  console.log(words);
  if (token == matterMostTokenToValidate && matterMost_channel_id == channel_id) {
    validateCommand(words, function(err, data) {
      console.log(err);
      if (err) {
        responseObj.text = err;
        callback(null, responseObj);
      } else {
        executeCommand(words, function(err, data){
          console.log('in executeCommand..');
          if (err) {
            responseObj.text = err;
            callback(null, responseObj);
          } else {
            callback(null, data);
          }
        });
      }
    });
  } else {
    responseObj.text = "Not Authorized!!!";
    callback(null, responseObj)
  }

}
