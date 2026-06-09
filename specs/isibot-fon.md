# Isibot Flow

## EXAMPLE KV Object
{
  "tenant_id": "cust_pluracon_0815",
  "business_name": "Tierarztpraxis Dr. Bäumer",
  "max_concurrent_calls": 3,
  "config": {
    "language": "de-DE",
    "voice": "Polly.Marlene",
    "timezone": "Europe/Berlin"
  },
  "business_hours": {
    "monday": { "open": "08:00", "close": "18:00" },
    "tuesday": { "open": "08:00", "close": "18:00" },
    "wednesday": { "open": "08:00", "close": "13:00" },
    "thursday": { "open": "08:00", "close": "18:00" },
    "friday": { "open": "08:00", "close": "16:00" },
    "saturday": null,
    "sunday": null
  },
  "flow": {
    "welcome_open": {
      "type": "dial",
      "audio_url": "https://r2.pluracon.org/cust_0815/welcome_open.mp3",
      "tts_text": "Hallo und willkommen bei der Tierarztpraxis Dr. Bäumer. Einen kleinen Moment, wir stellen Sie jetzt durch.",
      "phone_number": "+491701111111",
      "timeout": 20,
      "busy_fallback": "record_anliegen"
    },
    "welcome_closed": {
      "type": "gather",
      "audio_url": "https://r2.pluracon.org/cust_0815/welcome_closed.mp3",
      "tts_text": "Hallo und herzlich willkommen bei der Tierarztpraxis Dr. Bäumer. Sie rufen außerhalb unserer Praxiszeiten an. Möchten Sie eine Nachricht hinterlassen? Drücken Sie bitte die 1. Möchten Sie einen Termin vereinbaren? Drücken Sie bitte die 2. Handelt es sich um einen Notfall? Dann drücken Sie bitte die 3.",
      "num_digits": 1,
      "timeout": 5,
      "routes": {
        "1": "record_anliegen",
        "2": "record_termin",
        "3": "emergency_dial"
      },
      "no_input_route": "no_input_fallback"
    },
    "no_input_fallback": {
      "type": "gather",
      "audio_url": "https://r2.pluracon.org/cust_0815/no_input.mp3",
      "tts_text": "Es wurde keine Eingabe erkannt. Bitte tätigen Sie mithilfe der Telefon Tastatur eine Auswahl. Möchten Sie eine Nachricht hinterlassen? Drücken Sie bitte die 1. Möchten Sie einen Termin vereinbaren? Drücken Sie bitte die 2. Handelt es sich um einen Notfall? Dann drücken Sie bitte die 3.",
      "num_digits": 1,
      "timeout": 5,
      "routes": {
        "1": "record_anliegen",
        "2": "record_termin",
        "3": "emergency_dial"
      },
      "no_input_route": "hangup_node"
    },
    "record_anliegen": {
      "type": "record",
      "audio_url": "https://r2.pluracon.org/cust_0815/say_state_anliegen.mp3",
      "tts_text": "Okay. Bitte nennen Sie jetzt Ihr Anliegen nach dem Signalton.",
      "play_beep": true,
      "max_length": 60,
      "silence_timeout": 3,
      "next_step": "ask_contact_details"
    },
    "record_termin": {
      "type": "record",
      "audio_url": "https://r2.pluracon.org/cust_0815/say_state_termin.mp3",
      "tts_text": "Okay. Bitte nennen Sie jetzt Ihren Terminwunsch nach dem Signalton.",
      "play_beep": true,
      "max_length": 60,
      "silence_timeout": 3,
      "next_step": "ask_contact_details"
    },
    "ask_contact_details": {
      "type": "record",
      "audio_url": "https://r2.pluracon.org/cust_0815/ask_contact.mp3",
      "tts_text": "Vielen Dank. Bitte nennen Sie uns jetzt noch Ihren Namen und Ihre Telefonnummer für den Rückruf.",
      "play_beep": true,
      "max_length": 30,
      "silence_timeout": 3,
      "next_step": "final_goodbye"
    },
    "emergency_dial": {
      "type": "dial",
      "audio_url": "https://r2.pluracon.org/cust_0815/say_connecting.mp3",
      "tts_text": "Okay. Wir versuchen Sie direkt auf unserem Notfalltelefon durchzustellen. Sollten Sie niemanden erreichen, versuchen Sie es bitte später erneut.",
      "phone_number": "+491709999999",
      "timeout": 25,
      "busy_fallback": "record_anliegen"
    },
    "final_goodbye": {
      "type": "hangup",
      "audio_url": "https://r2.pluracon.org/cust_0815/goodbye.mp3",
      "tts_text": "Vielen Dank. Wir werden uns so schnell wie möglich bei Ihnen zurückmelden. Haben Sie noch einen schönen Tag und auf Wiederhören!"
    },
    "hangup_node": {
      "type": "hangup",
      "audio_url": "https://r2.pluracon.org/cust_0815/goodbye_timeout.mp3",
      "tts_text": "Es wurde keine Eingabe erkannt. Bitte rufen Sie erneut an. Einen schönen Tag!"
    }
  }
}

## Isibot Flow Types


### 1. Das Herzstück: `renderNode(nodeId, customerFlow, sessionDo)`

Das ist der zentrale Dirigent. Diese Funktion wird bei jedem HTTP-Request von Twilio aufgerufen. Sie holt sich die Konfiguration des aktuellen Schritts und ruft die passende TwiML-Builder-Funktion auf.

- **Input:** `nodeId` (z. B. `"welcome_closed"`), das `flow`-Objekt aus dem KV, und die Referenz zum Durable Object für diesen Call.
    
- **Logik:** Ein einfaches `switch(node.type)` leitet an die spezialisierten Funktionen weiter.
    

### 2. Die Schritt-Funktionen (TwiML-Generatoren)

Jeder Node-Typ aus deinem Editor braucht eine Funktion, die valides TwiML zurückgibt und parallel den Zustand im Durable Object (DO) aktualisiert.

#### `handleGatherNode(node, sessionDo)`

Wird für alle Menüs und Abfragen genutzt (z. B. deine Boxen `O0KSOTpl9YXOpsysW5ZyB` und `SN9COoBzylRzMDbCLXwGk`).

- **Funktion:** Generiert das `<Gather>`-Tag mit der im KV hinterlegten `<Say>`-Ansage oder dem `<Play>`-Audiolink.
    
- **Twilio-Parameter:** Setzt `action="/?step=process_gather"` und fügt die `nodeId` als Parameter an, damit der Worker beim Tastendruck weiß, aus welchem Menü der User kommt.
    

#### `handleRecordNode(node, sessionDo)`

Wird für die Sprachnachrichten und die VAD (Voice Activity Detection) genutzt (deine Boxen `W9AF6pXL5y060Xi60Zb2M` und `HHD8r4pBWRymXPd-Nk7Hd`).

- **Funktion:** Generiert das `<Record>`-Tag.
    
- **Twilio-Parameter:** Setzt `action="/?step=process_recording"`. Sie konfiguriert das `timeout` (z. B. 3 Sekunden Stille = fertig gesprochen) und das `maxLength`-Attribut basierend auf den KV-Daten des Kunden.
    

#### `handleDialNode(node, sessionDo)`

Wird für das Durchstellen auf das Handy genutzt (deine Boxen `s-atBmV2q0ZynA0Pj9zoe` und `rIYpfR_0AOCrSkjlDqus-`).

- **Funktion:** Inkrementiert über das Durable Object den globalen `active_call_count` für das Concurrency-Limit. Generiert dann das `<Dial>`-Tag mit der Zielnummer.
    
- **Twilio-Parameter:** Setzt `action="/?step=process_dial_outcome"`, um abzufangen, ob der Arzt besetzt war, weggedrückt hat oder rangegangen ist.
    

#### `handleHangupNode(node, sessionDo)`

Das End-Szenario (deine Boxen `dy_ujTj238kzc_30pCsLh` und `iuloE46FflRcI_F4SwxkA`).

- **Funktion:** Dekrementiert die Leitung im DO, spielt ein finales `<Say>Auf Wiedersehen</Say>` und hängt mit `<Hangup/>` ein.
    

### 3. Die Callback-Verarbeiter (State-Maschinen)

Wenn der Anrufer eine Aktion ausgeführt hat (Taste gedrückt oder fertig gesprochen), schickt Twilio die Daten zurück. Dafür brauchst du zwei zentrale Verarbeitungs-Funktionen:

#### `processGatherInput(request, customerFlow, sessionDo)`

- **Logik:** 1. Liest `params.get('Digits')`.
    
    2. Schaut im aktuellen KV-Knoten nach: `const nextNodeId = node.routes[digits]`.
    
    3. **No-Input Fallback:** Wenn keine Digits da sind, erhöhe im Durable Object die `menu_attempts`. Wenn `attempts >= 3`, setze `nextNodeId = node.no_input_route` (führt zum Auflegen). Ansonsten spiele das Menü erneut ab.
    
    4. Ruft `renderNode(nextNodeId, ...)` auf.
    

#### `processRecordingInput(request, customerFlow, sessionDo)`

- **Logik:**
    
    1. Fängt die `RecordingUrl` ab, die Twilio nach dem Sprechen generiert hat.
        
    2. Nutze `ctx.waitUntil(triggerBackendPipeline(...))`, um die Audio-URL völlig asynchron und ohne das Telefonat zu verzögern an deine KI-Pipeline (Whisper $\rightarrow$ Supabase/Pluradash $\rightarrow$ SMS) zu schicken.
        
    3. Schaut im KV nach dem nächsten Schritt: `const nextNodeId = node.next_step`.
        
    4. Ruft `renderNode(nextNodeId, ...)` auf (z. B. um nach der Nachricht direkt die Kontaktdaten abzufragen).