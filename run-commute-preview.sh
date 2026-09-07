#!/bin/sh
# Workspace-only preview launcher. Secret values are in private files outside
# the source project and are never embedded in the command or distributions.
set -eu
export BMC_API_KEY_FILE=/home/user/.secrets/commute/bmc_key
export DELIJN_API_KEY_FILE=/home/user/.secrets/commute/delijn_key
cd /home/user/commute
exec python server.py --port 3000
