# DX-Bericht: Pluracon Specy MCP und Event-Workflow

**Datum:** 04.10.2026  
**Kontext:** Anbindung der bestehenden Freytag-Akademie-Veranstaltungen an Specy; vorhandenes Themenwerkstatt-Angebot und zwei datierte Termine.  
**Ergebnis:** Event-Schema ist registriert; Produkt und beide Termine sind veröffentlicht. Die Worker-Startseite sowie beide Event-Detailrouten liefern HTTP 200. Der Ablauf war grundsätzlich nutzbar, hatte aber mehrere Schnittstellen- und Schema-Probleme, die den normalen Page-Builder-Workflow erschweren.

> Registrierungscodes, Authentifizierungswerte und der Revalidierungs-Secret sind absichtlich nicht in diesem Bericht enthalten.

## Zusammenfassung

Der MCP-Workflow konnte das dauerhafte Veranstaltungsprodukt und datierte Events korrekt als getrennte Aggregate modellieren:

- Ein Service-Product repräsentiert das wiederkehrende Format „Themenwerkstatt – Live-Online-Gruppenseminar“.
- Jedes Datum wird als eigener Event-Datensatz mit `product_id`, Datum, Uhrzeit, Dauer, Zeitzone, Modus und Personalbedarf angelegt.
- Der Event-Datensatz wird atomar mit einer Event-Seite verknüpft.
- Das Event-Schema wurde beim Worker `freytag-akademie-dev.jay-rathjen55.workers.dev` registriert. Die öffentliche, schema-scoped Pages-API liefert danach die beiden veröffentlichten Eventseiten; Startseite und Detailrouten funktionieren.

**Wichtigste verbleibende DX-Probleme:** `specy_pages_schemas_update_definition` lieferte wiederholt HTTP 522, und die öffentliche Event-Pages-API gibt die separat gespeicherten operativen Event-Fakten nicht mit zurück. Dadurch musste die Website Datum/Uhrzeit/Dauer zusätzlich aus Seiteninhalt lesen. Diese Anzeige-Felder sind jedoch nicht im registrierten Event-Schema definiert. Der aktuelle Test funktioniert, aber der normale Editor-Workflow für künftige Events ist damit nicht vollständig selbsterklärend.

## Verwendete Tools und beobachtetes Verhalten

| Tool | Beobachtung |
|---|---|
| `start_here` | Verständliche Orientierung zu Authentifizierung, Aggregaten und den Event-/Produktabläufen. Der MCP-Zugang war bereits authentifiziert; es trat kein 401 auf. |
| `specy_pages_schemas_list`, `list_schemas`, `specy_pages_schemas_get`, `get_schema_spec` | Lieferten Tenant-, API-Slug-, Schema-, Revisions- und Integrationsdaten. Die Trennung von `api_slug`, lokalem `schema_slug` und interner ID sollte in Beispielen deutlicher erklärt werden. |
| `list_available_tools`, `specy-schema-docs` | Hilfreich, um die verfügbaren Funktionen und das Schemaformat zu verstehen. Die dokumentierten Array-Typen stimmen jedoch nicht vollständig mit einem vorhandenen Schema überein, das `string[]` verwendet. |
| `specy_products_list/get/create/update/publish` | Produkt-Lese- und Aggregate-Workflows funktionierten. `create` erzeugte Produkt und kanonische Seite als Entwurf; Aktualisierung und Veröffentlichung verwendeten Versionsprüfungen. |
| `create_schema`, `start_schema_registration` | Erzeugten tenant-eigene Schemas; `start_schema_registration` lieferte einen Code und setzte den Status auf `waiting`. Anschließend war eine Frontend-Registrierung erforderlich. |
| `specy_pages_schemas_create_page` | Legte für ein Event atomar den operativen Event-Datensatz und eine verknüpfte Seite im Entwurfsstatus an. `product_id`-Verknüpfung und operative Pflichtfelder wurden akzeptiert. |
| `specy_pages_schemas_update_page` | Eventseite ließ sich mit `expected_definition_revision` und `expected_page_updated_at` veröffentlichen. Zusätzliche Inhaltsfelder, die nicht in der Schema-Definition standen, wurden beim Update ebenfalls akzeptiert und unverändert gespeichert. |
| `specy_pages_schemas_update_system_data` | Konnte den Legacy-`slug_structure` korrigieren. |
| `register_frontend` | Registrierte das Event-Schema erfolgreich für den Worker; Ergebnis HTTP 200. Sammlungsslot und Detailroute wurden angelegt. |
| `check_health` | Bestätigte die Erreichbarkeit des Workers mit HTTP 200. Der `/api/revalidate`-POST wurde nach Secret-Konfiguration mit HTTP 200 bestätigt. |

## Befunde für Specy-Entwicklung

### P1 — Schema-Definitionsupdates liefern HTTP 522

**Betroffene Funktion:** `specy_pages_schemas_update_definition`  
**Schema:** `Akademie-Veranstaltung` (`akademie-veranstaltung`, API-ID `be60dfc1-b97e-49fe-91e5-05d1a31a5eae`)

**Reproduktion / beobachtetes Verhalten:**

1. Mit der aktuellen `definition_revision` (1) eine Definitionserweiterung anfragen, zum Beispiel Felder `date`, `dateDisplay`, `time`, `duration` und `groupSize` ergänzen.
2. MCP antwortet mit `Schema definition update failed (522)` / `http_status: 522`.
3. `specy_pages_schemas_get` zeigt danach weiterhin Revision 1 und die ursprüngliche Definition.

Dasselbe 522 trat auch beim Versuch auf, das vorhandene `Service-Product`-Schema von `entity_kind: page` auf `service-product` zu korrigieren. Zusätzlich schlug eine spätere erneute Event-Schema-Erweiterung wieder mit 522 fehl. Andere Lese-, Seiten- und Registrierungsoperationen funktionierten währenddessen.

**Auswirkung:** Agenten können ein Schema nicht zuverlässig an die tatsächlich vom Frontend benötigten Felder anpassen. Eine Änderung darf nach 522 nicht als gespeichert behandelt werden; im Test blieb die Revision unverändert.

**Bitte prüfen:** Timeout/Transaktionspfad des Definitionsupdates, Optimistic-Lock-Verhalten sowie Fehlerbehandlung. Wenn die Definition absichtlich nicht updatefähig ist, wäre eine klare Validierungsantwort besser als 522.

### P1 — Öffentliche Event-Pages-API enthält keine operativen Event-Fakten

**Öffentlicher Endpunkt nach Registrierung:**

`GET /api/schemas/{event-api-slug}/pages`

Nach Registrierung lieferte der Endpunkt HTTP 200 und die veröffentlichten Seiten mit `slug`, `name`, `status` und `content`. Für die Eventseite war jedoch kein `event`-Objekt und kein anderes Feld mit operativen Daten enthalten (`event_fields=[]`). Auch `specy_pages_schemas_get_page` zeigte die Seiteninhalte, aber nicht die verknüpften operativen Event-Fakten.

Die operative Event-Erstellung speichert Datum, Uhrzeit, Dauer, Zeitzone und Modus separat. Das Frontend braucht aber mindestens das Datum, um kommende Events auf der Startseite zu sortieren, und Zeit/Dauer für die Detailseite. Weil die öffentliche API diese Fakten nicht liefert, wurden beim Testtermin zusätzlich `date`, `dateDisplay`, `time`, `duration` und `groupSize` in `page.content` gespeichert. Diese zusätzlichen Schlüssel wurden vom Seitenupdate akzeptiert und danach in der öffentlichen Pages-Antwort geliefert.

**Auswirkung:** Eine über PageBuilder regulär angelegte Eventseite enthält möglicherweise keinen `content.date`-Wert und wird von der Startseite nicht als kommendes Event angezeigt. Die aktuelle Implementierung kann Eventdaten nicht allein aus dem operativen Event-Datensatz rendern.

**Bitte klären/fixen:** Entweder die veröffentlichte Event-Pages-API um eine dokumentierte öffentliche Event-Projektion erweitern, zum Beispiel `event: { date, time, duration_minutes, timezone, mode, ... }`, oder diese display-relevanten Felder explizit im Event-Seitenschema anbieten. Wichtig wäre außerdem eine klare Festlegung, welche Datenquelle für die öffentliche Darstellung maßgeblich ist, damit zwei Datums-/Zeitkopien nicht auseinanderlaufen.

### P1 — `string[]`-Schemafeld wird beim Produkt-Publish abgelehnt

**Betroffene Funktion:** `specy_products_publish`  
**Beobachtete Antwort:** HTTP 400, Code `22023`: `cards[6].items uses unsupported schema type "string[]".`

Das Produktseiten-Schema enthielt bei `cards[].items` den Typ `string[]`. Der Fehler trat auf, als der Karteninhalt dieses Feld verwendete. Die übrigen Karten ohne `items` verhinderten die Veröffentlichung nicht. Als Workaround wurde die Liste in eine normale `description` umgewandelt; danach ließ sich das Produkt veröffentlichen.

**Inkonsistenz:** Die Schema-Dokumentation empfiehlt für Listen `type: "array"` mit einem `items`-Schema. Ein vorhandenes `Service-Product`-Schema verwendet dagegen `string[]`. Die Veröffentlichung validiert diesen Typ nicht wie erwartet.

**Bitte prüfen:** Schema-Validierung vereinheitlichen und inkompatible Typen schon bei `create_schema` bzw. `update_definition` verständlich zurückweisen. Idealerweise werden vorhandene Schemas mit `string[]` weiterhin unterstützt oder eine automatische Migration angeboten.

### P2 — Erzeugte Legacy-`slug_structure` weicht von den Integrationsanforderungen ab

Bei `create_schema` wurde für das Event-Schema `required_slug_structure: "/veranstaltungen/:slug"` und `route_base_path: "/veranstaltungen"` übergeben. Das Schema erhielt zunächst trotzdem `slug_structure: "/:slug"`. Die Metadaten mussten anschließend separat mit `specy_pages_schemas_update_system_data` korrigiert werden.

**Bitte prüfen:** Bei Schema-Erstellung `slug_structure` aus `required_slug_structure` übernehmen oder Unterschiede explizit melden. Eine doppelte Routing-Konfiguration ohne klare Priorität ist fehleranfällig.

### P2 — Slug-Normalisierung entfernt Unterstriche vollständig

Beim Erstellen des vorhandenen Slugs `themenwerkstatt_22102026` entstand `themenwerkstatt22102026`; der Unterstrich wurde nicht in einen Bindestrich umgewandelt. Das ist eine Änderung des erwarteten URL-Identifikators und kann bestehende Links brechen.

**Bitte prüfen:** Dokumentierte Slug-Normalisierung (Unterstrich erhalten oder in `-` umwandeln) und gegebenenfalls Warnung/Redirect-Unterstützung bei URL-Migration.

## Erfolgreicher End-to-End-Test

Nach Bereitstellung des Workers wurden folgende Schritte erfolgreich abgeschlossen:

1. Event-Schema mit `entity_kind: event`, `content_scope: page-collection` und Route `/veranstaltungen/:slug` erstellt.
2. Service-Product-Schema `Veranstaltungsprodukt` tenant-owned angelegt; Produkt erstellt und veröffentlicht.
3. Pilottermin 22.10.2026 sowie Testtermin 22.11.2026 atomar als Events mit dem Produkt verknüpft; beide Seiten veröffentlicht.
4. Event-Schema über `register_frontend` mit dem Worker registriert; API-Status wechselte auf `registered`.
5. Öffentliche Pages-API lieferte HTTP 200 und beide veröffentlichten Events.
6. Worker-Startseite zeigte beide Termine; beide Detailrouten lieferten HTTP 200.
7. Authentifizierter POST auf `/api/revalidate` lieferte HTTP 200.

Der neue Testtermin enthält dieselben Angaben wie angefragt: Sonntag, 22.11.2026, 18:00 Uhr, Europe/Berlin, 150 Minuten, online über Microsoft Teams, 3–10 Teilnehmende und 89 € pro Teilnehmer. Die 89 € wurden als Preis für genau diesen Termin hinterlegt, nicht als allgemeine Preiszusage für zukünftige Veranstaltungen.

## Referenzen (nicht geheim)

- Event-Schema: `akademie-veranstaltung`, API-ID `be60dfc1-b97e-49fe-91e5-05d1a31a5eae`, Revision 1
- Produkt-Schema: `veranstaltungsprodukt`, API-ID `84036751-20ea-4aea-8361-c70f566d4581`
- Aktiver Worker: `https://freytag-akademie-dev.jay-rathjen55.workers.dev`
- Event-Routen: `/veranstaltungen/themenwerkstatt22102026` und `/veranstaltungen/themenwerkstatt22112026`

Für eine Weitergabe an Specy bitte keine Registrierungscodes, Bearer-Tokens oder Revalidierungs-Secrets anhängen.
