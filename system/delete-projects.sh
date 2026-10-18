#!/bin/bash
for i in $(find -H .projects.env projects.env -type f -name "*.env" 2>/dev/null); do
  rm $i
done