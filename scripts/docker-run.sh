set -e
docker build . --target processor -t squid-processor
# make sure the port matches .env. 
# For Linux, add --add-host=host.docker.internal:host-gateway
docker run --rm -e DB_HOST=host.docker.internal --add-host=host.docker.internal:host-gateway --env-file=.env squid-processor