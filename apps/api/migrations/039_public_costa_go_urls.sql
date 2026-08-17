UPDATE support_faqs
SET answer = replace(
      answer,
      'https://mototaxi-atacames-admin.onrender.com/fares.html',
      'https://costa-go.com/fares.html'
    ),
    updated_at = now()
WHERE answer LIKE '%https://mototaxi-atacames-admin.onrender.com/fares.html%';
