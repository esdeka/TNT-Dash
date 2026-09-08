/* Optional: copy to Dashboard-secrets.js next to Dashboard.html to give the
   standalone page direct operator access without rebuilding. Manual entries
   made in the page (Reference -> API keys) take precedence over this file,
   which in turn takes precedence over any build-embedded keys. Keep the real
   file private: it is git-ignored and must never be committed or shared. */
window.COMMUTE_SECRETS = { bmc: "YOUR-BELGIAN-MOBILITY-KEY", delijn: "YOUR-DE-LIJN-KEY" };
