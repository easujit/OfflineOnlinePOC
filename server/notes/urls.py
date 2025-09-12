from django.urls import path
from .views import sync, mutations

urlpatterns = [
    path('sync', sync),
    path('mutations', mutations),
]
