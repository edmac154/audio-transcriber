FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

ENV NEXT_PUBLIC_API_URL=http://localhost:4000

EXPOSE 3000

CMD ["npm", "run", "dev"]
