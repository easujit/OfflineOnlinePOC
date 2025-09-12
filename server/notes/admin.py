from django.contrib import admin
from .models import Note, Event, Idempotency

@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "version", "updated_at")
    search_fields = ("id", "title", "content")
    ordering = ("-updated_at",)

@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("id", "entity_type", "entity_id", "op", "version", "updated_at")
    search_fields = ("entity_id",)
    ordering = ("-updated_at",)

@admin.register(Idempotency)
class IdempotencyAdmin(admin.ModelAdmin):
    list_display = ("key",)
    search_fields = ("key",)
