FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx tsc -p .
EXPOSE 4001
CMD ["node", "dist/index.js"]
