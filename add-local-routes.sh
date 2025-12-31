#!/bin/bash

# Script to add local routes to all connector configuration files

for file in examples/mesh-4-nodes-*.yaml examples/hub-spoke-*.yaml examples/linear-5-nodes-*.yaml examples/complex-8-node/*.yaml; do
  if [ -f "$file" ]; then
    nodeId=$(grep "^nodeId:" "$file" | awk '{print $2}')
    if [ -n "$nodeId" ]; then
      # Check if local route already exists
      if ! grep -q "prefix: g\\.$nodeId\$" "$file"; then
        echo "Adding local route to $file (nodeId: $nodeId)"
        # Find the last route entry and add the new route after it
        # This uses a more portable approach
        cat "$file" | awk -v nodeId="$nodeId" '
          /^routes:/ { inRoutes=1 }
          { print }
          END {
            if (inRoutes) {
              print ""
              print "  - prefix: g." nodeId
              print "    nextHop: " nodeId
              print "    priority: 0"
            }
          }
        ' > "$file.tmp"
        mv "$file.tmp" "$file"
      else
        echo "Local route already exists in $file"
      fi
    fi
  fi
done

echo "Done adding local routes"
