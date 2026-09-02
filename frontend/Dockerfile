FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_CIV_URL=http://localhost:4001
ARG VITE_ORCH_URL=http://localhost:4002
ENV VITE_CIV_URL=$VITE_CIV_URL
ENV VITE_ORCH_URL=$VITE_ORCH_URL
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
