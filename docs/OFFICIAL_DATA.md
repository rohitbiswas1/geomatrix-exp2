# Official project records

The bundled JSON contains 30 manually reviewed records from the Ministry of Statistics and Programme Implementation (MoSPI), Flash Report on Central Sector Infrastructure Projects costing ₹150 crore and above, May 2024.

Source: https://www.mospi.gov.in/sites/default/files/publication_reports/FlashReport_May_2024.pdf

- Snapshot date: 31 May 2024; this is not a current live feed.
- PDF page 97, Annexure V: 11 on-schedule civil aviation projects.
- PDF pages 158–159, Annexure VII: 19 projects reporting anticipated overall schedule slippage.
- Project codes, agencies, costs in crore rupees, approval/commissioning months and report page links are retained. Display names are normalized from table text; the table truncates some titles.
- The original printed code for BHAVINI is 020100044, rather than an invented N-prefixed code.
- A dash in expenditure is unknown, not zero.
- Nil delay reasons retain the source wording; this does not prove that no cause exists.
- Reported months measure anticipated overall commissioning versus original commissioning. These are neither actual completed delays nor labels establishing land-acquisition causation.
- Land area, families, parcel counts, compensation, court cases, acquisition stage, clearances and exact coordinates were not supplied by these tables. They are explicitly marked unreported; no Google snippet or language-model guess fills them.
- The importer never treats schedule slippage or supplied risk labels as model predictions.
- Required acquisition inputs must be present in the source or supplied by a verified edit before prediction. Training rejects constant feature matrices, including imports containing schedule labels alone.
- Re-import skips existing project codes and never silently overwrites user edits.

Use the Projects page import action, or download and upload the JSON through the same validated upload endpoint. The model requires verified historical acquisition inputs measured before the delay outcome; the source report alone is insufficient for that model.
