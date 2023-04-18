'use strict';

require('dotenv').config()

if(!process.env.AWS_REGION) {
	console.error('Missing AWS region in env');
	process.exit(1);
}

if(!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)) {
	console.warn('No accessKeyId and secretAccessKey provided for the aws sdk!');
}

if(!process.env.DOMAIN) {
	console.error('Missing domain in env');
	process.exit(1);
}

const tester = require('acme-dns-01-test');
var type = 'dns-01';

var challenger = require('./index.js').create({
	region: process.env.REGION,
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const domain = process.env.DOMAIN;

tester.testZone(type, domain, challenger).then(function() {
	console.info('PASS');
}).catch(function(err) {
	console.error('FAIL');
	console.error(err);
	process.exit(1);
});