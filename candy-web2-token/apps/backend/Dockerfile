FROM node:22-alpine
WORKDIR /app
COPY apps/backend/package.json ./apps/backend/package.json
RUN cd apps/backend && npm install --omit=dev
COPY apps/backend ./apps/backend
COPY config ./config
WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate && npm start"]
