# Voice Call Extension for Zee

Make and manage voice calls via Twilio, Telnyx, or Plivo from Zee.

## Features

- **Multiple Providers**: Twilio, Telnyx, Plivo, and Mock (for testing)
- **Call Management**: Initiate, continue, end, and check status of calls
- **TTS Integration**: Speak messages during active calls
- **Webhook Support**: Handle async events from providers
- **CLI Commands**: Manage calls from the command line

## Configuration

Add to your `~/.zee/zee.json`:

```json
{
  "plugins": {
    "entries": {
      "voice-call": {
        "enabled": true,
        "config": {
          "provider": "twilio",
          "fromNumber": "+15551234567",
          "twilio": {
            "accountSid": "your-account-sid",
            "authToken": "your-auth-token"
          }
        }
      }
    }
  }
}
}
```

### Provider-Specific Configs

**Twilio:**
```json
{
  "provider": "twilio",
  "fromNumber": "+15551234567",
  "twilio": {
    "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "authToken": "your-auth-token"
  }
}
```

**Telnyx:**
```json
{
  "provider": "telnyx",
  "fromNumber": "+15551234567",
  "telnyx": {
    "apiKey": "KEYxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "connectionId": "conn-xxxxxx"
  }
}
```

**Plivo:**
```json
{
  "provider": "plivo",
  "fromNumber": "+15551234567",
  "plivo": {
    "authId": "your-auth-id",
    "authToken": "your-auth-token"
  }
}
```

**Mock (for testing):**
```json
{
  "provider": "mock",
  "fromNumber": "+15550000000"
}
```

## Usage

### Agent Tool

```javascript
// Start a call
{ action: "initiate_call", to: "+15559876543", message: "Hello from Zee" }

// Speak during a call
{ action: "continue_call", callId: "CA123...", message: "Let me check that" }

// End a call
{ action: "end_call", callId: "CA123..." }

// Get status
{ action: "get_status", callId: "CA123..." }
```

### CLI Commands

```bash
# Start a call
zee voicecall start --to "+15559876543" --message "Hello from Zee"

# Check status
zee voicecall status --call-id "CA123..."

# Speak during call
zee voicecall speak --call-id "CA123..." --message "How can I help?"

# End call
zee voicecall end --call-id "CA123..."

# List active calls
zee voicecall list
```

### Gateway Methods

- `voicecall.initiate` - Start a new call
- `voicecall.continue` - Continue/speak during a call
- `voicecall.speak` - Alias for continue
- `voicecall.end` - End a call
- `voicecall.status` - Get call status
- `voicecall.start` - CLI convenience alias

## Testing

Use the `mock` provider for testing without making real calls:

```json
{
  "provider": "mock",
  "fromNumber": "+15550000000"
}
```

Mock calls simulate the full call lifecycle and log messages to console.

## Webhooks

For production use, configure webhooks in your provider dashboard to point to:

```
https://your-zee-gateway/webhook/voice-call
```

This enables real-time status updates and recording delivery.

## Security Notes

- Store credentials in environment variables or secure vaults
- Use webhook signature verification
- Restrict `allowFrom` to authorized numbers
- Enable recording only when necessary (legal compliance)

## Costs

Voice calls incur charges from your provider:
- **Twilio**: ~$0.013/minute (US)
- **Telnyx**: ~$0.007/minute (US)
- **Plivo**: ~$0.0065/minute (US)

Use the mock provider for development and testing.
