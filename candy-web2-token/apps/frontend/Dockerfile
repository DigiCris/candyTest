FROM node:22-alpine AS build
WORKDIR /app
COPY packages/candy-sdk ./packages/candy-sdk
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN cd apps/frontend && npm install
COPY apps/frontend ./apps/frontend
RUN cd apps/frontend && npm run build

FROM nginx:1.27-alpine
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
