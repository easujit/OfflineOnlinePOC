from rest_framework import serializers

class MutationSerializer(serializers.Serializer):
    intent_type = serializers.CharField()
    entity_type = serializers.CharField()
    entity_id = serializers.CharField()
    patch = serializers.DictField(child=serializers.CharField(), allow_empty=True)
    base_version = serializers.IntegerField()
    ts = serializers.IntegerField(required=False)
    retries = serializers.IntegerField(required=False)
