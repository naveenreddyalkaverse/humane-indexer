# humane-indexer

## APIs

```
Note:
    * Indexer APIs are available at: `http://<server-url>/:instanceName/indexer/api`.
    * All types must be valid index types defined in configuration.
    * BODY must be valid `JSON`.
    * All requests shall have `Content-Type` header as: `Content-Type: application/json`
```

### Upsert

This method adds data of given type if it does not exist, else updates.

###### **Method 1**

- TYPE  : `POST`

- URL   : `/upsert`

- BODY  : `{type: <type>, doc: <data>}`

###### **Method 2**

- TYPE  : `POST`

- URL   : `/:type`

- BODY  : `{doc: <data>}`

- SUCCESS RESPONSE  : Same as method 1

- ERROR RESPONSES   : Same as method 1

### Partial Update

This method is optimised for partial updates of given type and id.

- TYPE  : `POST`

- URL   : `/partialUpdate`

- BODY  : `{type: <type>, id: <id>, doc: <data>}`

### Full Update

This method does full update of document of given type and id.

###### **Method 1**

- TYPE  : `POST`

- URL   : `/update`

- BODY  : `{type: <type>, id: <id>, doc: <data>}`
  
###### **Method 2**

- TYPE  : `POST`

- URL   : `/:type/:id`

- BODY  : `{doc: <data>}`

- SUCCESS RESPONSE  : Same as method 1

- ERROR RESPONSES   : Same as method 1

### Remove

This method removes document of given type and id.

###### **Method 1**

- TYPE  : `POST`

- URL   : `/remove`

- BODY  : `{type: <type>, id: <id>}`

- SUCCESS RESPONSE  :

- ERROR RESPONSES   :
  
    - Case: Not found ID
    
###### **Method 2**

- Type  : `DELETE`

- URL   : `/:type/:id`

- SUCCESS RESPONSE  : Same as method 1

- ERROR RESPONSES   : Same as method 1

### Add

This method adds document of given type.

###### **Method 1**

- TYPE  : `POST`

- URL   : `/add`

- BODY  : `{type: <type>, doc: <data>}`

###### **Method 2**

- TYPE  : `PUT`

- URL   : `/:type`

- BODY  : `{doc: <data>}`

- SUCCESS RESPONSE  : Same as method 1

- ERROR RESPONSES   : Same as method 1

### Common Error Scenarios

- Case: Undefined Type - when type is not specified

- Case: Unrecognized Type - when type is not among the configured
         
- Case: Undefined ID - when ID is not specified or can not be calculated
  
- Case: Internal Service Error - when there is some internal service error

## Configuration