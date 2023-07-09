# real-time-locating-backend
Real-time locating system backend
Using Node.js, Express, and MySQL

## How to Run
1. Pastikan telah meng-install `Node.js (minimal versi 18)`
2. Pastikan telah meng-install `MySQL (versi 8)`
3. Buat database baru di `MySQL` dengan nama `real_time_locating_system`
4. Rename file `.env.example` menjadi `.env`. Isi file bisa diubah untuk mengatur konfigurasi.
5. Buat folder baru bernama `uploads` (tempat uploads gambar)
6. Jalankan `npm install` di terminal pada folder ini (untuk meng-install seluruh dependencies)
7. Jalankan `npm run db-migrate` untuk membuat tabel-tabel database
8. Untuk run, jalankan `npm run dev`
9. Untuk menghentikan, tekan `Ctrl + C`
