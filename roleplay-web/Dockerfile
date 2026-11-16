FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json build.mjs server.mjs ./
COPY src ./src
COPY drizzle ./drizzle
RUN node build.mjs
ENV HOST=0.0.0.0 PORT=4177 DATA_DIR=/data
EXPOSE 4177
CMD ["node", "server.mjs"]
