<<<<<<< HEAD
FROM php:8.2-cli

RUN apt-get update && apt-get install -y libpq-dev \
    && docker-php-ext-install pdo pdo_pgsql pgsql

WORKDIR /app
COPY . /app

EXPOSE 10000
=======
FROM php:8.2-cli

RUN apt-get update && apt-get install -y libpq-dev \
    && docker-php-ext-install pdo pdo_pgsql pgsql

WORKDIR /app
COPY . /app

EXPOSE 10000
>>>>>>> 5cdcc7b (Add login gate for bookings, My Bookings view, cancel option, and nav drawer)
CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-10000} -t public"]