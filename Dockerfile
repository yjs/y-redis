FROM node

WORKDIR /app
COPY . /app

RUN npm install
RUN (cd demos/auth-express && npm install)