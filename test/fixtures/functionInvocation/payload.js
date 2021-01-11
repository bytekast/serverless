'use strict';

module.exports = {
  service: 'payload',
  functions: {
    usersCreate: {
      events: [
        {
          http: 'post payload/create',
        },
      ],
    },
  },
  resources: {},
};