from django.urls import path
from .views import sync, mutations, fetch_notes

urlpatterns = [
    path('sync', sync),
    path('mutations', mutations),
    path('notes', fetch_notes),
]
