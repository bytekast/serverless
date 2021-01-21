'use strict';

module.exports = {
  service: 'payload',
  functions: {
    usersCreate: {
      handler: 'handler.hello',
      events: [
        {
          http: 'post payload/create',
        },
      ],
    },
  },
  resources: {},
};