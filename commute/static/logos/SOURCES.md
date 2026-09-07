# Operator logo assets

Fetched from the operators' own public websites on 7 September 2026. Used only to identify the operator of a listed departure; no endorsement is implied. Logos/trademarks remain the property of their owners. The transport-data CC BY licence is not asserted to cover these marks.

- **De Lijn** (`delijn.png`): https://www.delijn.be/assets/images/logo-mobile.png — cropped to the complete central De Lijn mark (source pixels x64–192, y44–163), omitting page-header decoration/outer whitespace. No repainting or generative recreation.
- **STIB/MIVB** (`mivb.png`): https://www.stib-mivb.be/modules/stibmivb-template/images/favicon/android-chrome-192x192.png — official compact mark; transparent margins trimmed.
- **Tour & Taxis** (`tnt.png`): https://tour-taxis.com/wp-content/themes/tour-et-taxis/library/dist/favicons/apple-touch-icon-180x180.png — official compact T&T mark; transparent margins trimmed. No marketing tagline is shown.

`build.py` embeds the three PNGs as data URIs in `operator-logos`. The browser does not contact an operator/CDN to load them. Logos preserve their native proportions and colours; delay colours apply to the numeric times. Walking and arriving-arrow symbols are unchanged.
