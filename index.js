'use strict';

async function wait(ms) {
    return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

require('dotenv').config()


const { Route53Client, ListHostedZonesCommand, ChangeResourceRecordSetsCommand, GetChangeCommand, ListResourceRecordSetsCommand } = require("@aws-sdk/client-route-53");
const { fromIni } = require("@aws-sdk/credential-provider-ini");
const { fromEnv } = require("@aws-sdk/credential-provider-env");

class Challenge {
	constructor(options = {}) {
        this.module = "acme-dns-01-route53";

        this.region = options.region ?? process.env.AWS_REGION;
		this.accessKeyId = options.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
		this.secretAccessKey = options.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;

        const credentials = fromEnv();
        this.route53 = new Route53Client({
            region: this.region,
            credentials
            // : fromIni({
			// 	accessKeyId: this.accessKeyId,
			// 	secretAccessKey: this.secretAccessKey
			// })
        });
    }

    static create(config){
		return new Challenge(Object.assign(config, this.options));
	}

    async init(){
		return null;
	}

	async zones(){
		let hostedZones = null;
        let hostedZoneArray = [];

        try {
            const listZonesCommand = new ListHostedZonesCommand({});
            const getHostedZonesResult = await this.route53.send(listZonesCommand);
            hostedZones = getHostedZonesResult.HostedZones;
        } catch (error) {
            console.log(error);
            throw Error (`No hosted zone found for the given hostname: ${hostname}`);
        }

        if (hostedZones.length <= 0) {
            throw Error(`No hosted zones exist for the given hostname: ${hostname}`);
        } else {
            hostedZones.forEach(hostedZone => {
                hostedZoneArray.push(hostedZone.Name);
            });
        }
        return hostedZoneArray;
	}

    async set(args){
		return new Promise(async (resolve) => {
            try {
                let hostname = args.domain;
                let dnsHost = args.challenge.dnsHost;
                let dnsAuthorization = args.challenge.dnsAuthorization;
                let ttl = args.challenge.ttl ?? 60;
                let wildcard = args.challenge.wildcard;

                const hostedZoneId = await this.findHostedZoneIdByDNSName(hostname, wildcard);

                const recordParams = this.createHostedZoneRecord(dnsHost, dnsAuthorization, hostedZoneId, ttl);
                await this.changeHostedZoneRecord(recordParams);
                resolve(null);
            } catch(error) {
                throw Error(error);
            }
        });
    }

    async remove(args){
		return new Promise(async (resolve) => {
            try {
			
                let hostname = args.domain;
                let dnsHost = args.challenge.dnsHost;
                let dnsAuthorization = args.challenge.dnsAuthorization;
                let ttl = args.challenge.ttl ?? 60;
                let wildcard = args.challenge.wildcard;
        
                const hostedZoneId = await this.findHostedZoneIdByDNSName(hostname, wildcard);
        
                const recordParams = this.deleteHostedZoneRecord(dnsHost, dnsAuthorization, hostedZoneId, ttl);
        
                await this.changeHostedZoneRecord(recordParams);
                
                resolve(null);
            } catch(error) {
                throw Error(error);
            }
        });
	}

    /* implemented for testing purposes */
    async get(args) {
		if(!args.challenge) {
			throw new Error('No challenge args passed to get function!');
		}
        if (!args.challenge.identifier) {
            throw new Error('No identifier provided for get function!');
        }
		try{
			const hostedZoneId = await this.findHostedZoneIdByDNSName(args.challenge.altname, args.challenge.wildcard);
			if(!hostedZoneId) {
				throw new Error(`Could not find an aws hosted zone for '${altname}'.`);
			}

            const resourceRecordsCommand = new ListResourceRecordSetsCommand({
                HostedZoneId: hostedZoneId,
              });

			const resourceRecordsResult = await this.route53.send(resourceRecordsCommand);
            const records = resourceRecordsResult.ResourceRecordSets;

			if(records.length < 1) {
				return null;
			}
			// filter the records by name and then find the record value
			let foundRecord = null;
			for(const record of records) {
				if(record.Name === (args.challenge.identifier.value + ".")) {
                    for(const recordSet of record.ResourceRecords) {
                        if (recordSet.Value === ('"' + args.challenge.dnsAuthorization + '"')) {
                            foundRecord = recordSet.Value.substring(1, recordSet.Value.length - 1);
                            break;
                        }
                    }
				}
			}
			if(!foundRecord) {
                console.log(`Could not find a record with the name: ${args.challenge.identifier.value} for the domain: ${args.challenge.altname}`);
				return null;
			}
			return {
				dnsAuthorization: foundRecord,
			};

		} catch (error) {
            throw new Error(`Could not get record! Error: ${error}`);
		}
	}

    async findHostedZoneIdByDNSName(hostname, wildcard) {
        if (wildcard) {
            const domainParts = hostname.split(".");
            hostname = domainParts.slice(-2).join(".");
            console.log(`Recieved a wildcard url. Trying to get to hosted zone id of the top level domain: ${hostname} instead!`);
    
        }
    
        let hostedZones = null;
        let hostedZoneId = null;
    
        try {
            const listHostedZonesCommand = new ListHostedZonesCommand({
                DNSNameFilter: hostname + ".",
            });

            const getHostedZonesResult = await this.route53.send(listHostedZonesCommand);
            hostedZones = getHostedZonesResult.HostedZones;
        } catch (error) {
            throw Error (`No hosted zone found for the given hostname: ${hostname};`, error);
        }
        if (hostedZones.length <= 0) {
            throw Error(`No hosted zones exist for the given hostname: ${hostname}`);
        } else {
            const hostedZone = hostedZones.find(zone => {
                return zone.Name === (hostname + '.');
            } );
            if (!hostedZone) {
                throw Error(`The given hostname was not among the found hosted zones`);
            } else {
                hostedZoneId = hostedZone.Id
            }
        }
    
        return hostedZoneId;
    }
    
    createHostedZoneRecord(dnsHost, value, hostedZoneId, ttl) {
        return {
            ChangeBatch: {
                Changes: [
                {
                    Action: 'UPSERT',
                    ResourceRecordSet: {
                        Name: dnsHost,
                        Type: 'TXT',
                        TTL: ttl,
                        ResourceRecords: [
                        {
                            Value: '"' + value + '"',
                        },
                        ],
                    },
                },
                ],
                Comment: 'Create TXT record for Let\'s Encrypt DNS validation',
            },
            HostedZoneId: hostedZoneId,
        };
    }
    
    deleteHostedZoneRecord(dnsHost, value, hostedZoneId, ttl) {
        return {
          ChangeBatch: {
            Changes: [
                {
                    Action: 'DELETE',
                    ResourceRecordSet: {
                        Name: dnsHost,
                        Type: 'TXT',
                        TTL: ttl,
                        ResourceRecords: [
                            {
                                Value: '"' + value + '"',
                            },
                        ],
                    },
                },
            ],
            Comment: 'Delete TXT record for Let\'s Encrypt DNS validation',
          },
          HostedZoneId: hostedZoneId,
        };
      }
    
    async changeHostedZoneRecord(recordParams) {
        let waitDNSRecordError = null;
        const changeCommand = new ChangeResourceRecordSetsCommand(recordParams)
      
        const recordChangeResult = await this.route53.send(changeCommand);
      
            if (!recordChangeResult) {
                throw Error(`The created hosted zone record could not be set in route53; recordParams: ${recordParams}`);
            } else {
                let changeStatus = null;
    
                do {
                    try {
                        const getChangeCommand = new GetChangeCommand({ Id: recordChangeResult.ChangeInfo.Id });
                        const getChangeResult = await this.route53.send(getChangeCommand);
                        
                            changeStatus = getChangeResult.ChangeInfo.Status;
                            console.log(`Waiting for the record change to be processed in aws. Checking again in 5 seconds ...`);
                        
                    } catch (error) {
                        console.log(`Wait for DNS Record processing by aws error: ${error}`);
                        waitDNSRecordError = `The status of the create aws change record could not be retrieved.`;
                    }
                    // wait 5 seconds, then try again
                    await wait(5000);
                } while (changeStatus !== "INSYNC" && !(waitDNSRecordError));
                console.log(`Record change processed successfully.`);
            }
    
            if (waitDNSRecordError) {
                throw Error(waitDNSRecordError);
            }
    
        return;
      }
}

module.exports = Challenge;
